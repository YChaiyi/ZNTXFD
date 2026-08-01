#!/bin/bash
# One-time, transactional source migration for the production content workstation.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
DEFAULT_SOURCE_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"
PRODUCTION_PROJECT_DIR="/Users/wangzong/Desktop/agent-knowledge-base"
DEFAULT_REPOSITORY="https://github.com/YChaiyi/ZNTXFD.git"

mode=""
project_dir="$PRODUCTION_PROJECT_DIR"
source_dir="$DEFAULT_SOURCE_DIR"
expected_repository="$DEFAULT_REPOSITORY"
expected_sha=""
backup_root=""
recovery_dir=""
content_paused=false
transaction_dir=""
transaction_complete=false
mutation_started=false

install_paths=(
  ".github"
  "ops"
  "scripts"
  "src"
  "tests"
  "public/token-rank"
  "public/favicon.ico"
  ".env.example"
  ".gitignore"
  "LICENSE"
  "README.md"
  "eslint.config.mjs"
  "next-env.d.ts"
  "next.config.ts"
  "package.json"
  "package-lock.json"
  "postcss.config.mjs"
  "tailwind.config.ts"
  "tsconfig.json"
  ".git"
)

# These local artifacts are retained in the external backup, but must not
# survive beside the new source because several contain retired deployment
# instructions or build state tied to the old tree.
quarantine_paths=(
  ".vercelignore"
  ".vercel"
  ".next"
  "node_modules"
  "AGENTS.md"
  ".claude"
  ".agents"
  ".codex"
  ".memory"
  ".znt-build-home"
)

usage() {
  cat <<'EOF'
Usage:
  scripts/sync_workstation_source.sh --dry-run --expected-sha <40-hex-sha> [options]
  scripts/sync_workstation_source.sh --apply --expected-sha <40-hex-sha> --confirm-content-paused [options]
  scripts/sync_workstation_source.sh --recover <migration-backup-dir>

Options:
  --project-dir <path>   Production project path (fixed by default).
  --source-dir <path>    Clean main clone containing this tool.
  --repository <url>     Expected origin and main repository.
  --backup-root <path>   External, same-volume backup directory.

Dry-run never writes the project or backup root. Apply preserves data, images,
environment files and runtime state in place. It does not generate or publish
content and does not contact the VPS.
EOF
}

die() {
  echo "source sync: $*" >&2
  exit 1
}

note() {
  printf '[source-sync] %s\n' "$*"
}

path_exists() {
  [ -e "$1" ] || [ -L "$1" ]
}

canonical_existing_dir() {
  [ -d "$1" ] && [ ! -L "$1" ] || return 1
  (cd "$1" && pwd -P)
}

read_dotenv_value() {
  local file="$1"
  local name="$2"
  local value=""
  [ -f "$file" ] || return 0
  value="$(sed -n "s/^${name}=//p" "$file" | tail -n 1)"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  printf '%s' "$value"
}

write_phase() {
  local phase="$1"
  printf 'PHASE\t%s\n' "$phase" >> "$transaction_dir/journal"
}

record_action() {
  local action="$1"
  local path="$2"
  printf '%s\t%s\n' "$action" "$path" >> "$transaction_dir/journal"
}

copy_path() {
  local source="$1"
  local destination="$2"
  mkdir -p "$(dirname "$destination")"
  cp -a "$source" "$destination"
}

move_path() {
  local source="$1"
  local destination="$2"
  mkdir -p "$(dirname "$destination")"
  mv "$source" "$destination"
}

manifest_protected() {
  local root="$1"
  local output="$2"
  node - "$root" "$output" <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(process.argv[2]);
const output = process.argv[3];
const roots = ["data", "public/digest-images"];
for (const name of fs.readdirSync(root)) {
  if ((name.startsWith(".env") && name !== ".env.example") || name === ".npmrc") {
    roots.push(name);
  }
}
roots.sort();

const records = [];
function visit(relative) {
  const absolute = path.join(root, relative);
  const stat = fs.lstatSync(absolute, { bigint: true });
  if (stat.isSymbolicLink()) {
    throw new Error(`protected path is a symbolic link: ${relative}`);
  }
  const base = {
    path: relative.split(path.sep).join("/"),
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: Number(stat.mode & 0o7777n),
  };
  if (stat.isDirectory()) {
    records.push({ ...base, type: "directory" });
    for (const name of fs.readdirSync(absolute).sort()) {
      visit(path.join(relative, name));
    }
    return;
  }
  if (!stat.isFile()) {
    throw new Error(`protected path is not a regular file or directory: ${relative}`);
  }
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(absolute));
  records.push({
    ...base,
    type: "file",
    size: stat.size.toString(),
    sha256: hash.digest("hex"),
  });
}

for (const relative of roots) {
  const absolute = path.join(root, relative);
  try {
    fs.lstatSync(absolute);
    visit(relative);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
fs.writeFileSync(output, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 });
NODE
}

validate_source_boundaries() {
  local tracked=""
  while IFS= read -r -d '' tracked; do
    case "$tracked" in
      .github/*|ops/*|scripts/*|src/*|tests/*|public/token-rank/*|public/favicon.ico|\
      .env.example|.gitignore|LICENSE|README.md|eslint.config.mjs|next-env.d.ts|\
      next.config.ts|package.json|package-lock.json|postcss.config.mjs|\
      tailwind.config.ts|tsconfig.json)
        ;;
      *)
        die "tracked source path is outside the workstation allowlist: $tracked"
        ;;
    esac
  done < <(git -C "$source_dir" ls-files -z)
}

validate_source() {
  source_dir="$(canonical_existing_dir "$source_dir")" || die "source directory is missing or symbolic: $source_dir"
  [ "$source_dir" != "$project_dir" ] || die "source clone and production project must be different directories"

  local head branch origin remote_sha remote_line
  head="$(git -C "$source_dir" rev-parse HEAD 2>/dev/null)" || die "source directory is not a Git repository"
  branch="$(git -C "$source_dir" branch --show-current 2>/dev/null)"
  origin="$(git -C "$source_dir" remote get-url origin 2>/dev/null)"
  [ "$head" = "$expected_sha" ] || die "source HEAD $head does not match expected SHA $expected_sha"
  [ "$branch" = "main" ] || die "source clone must be on main, found: ${branch:-detached}"
  [ "$origin" = "$expected_repository" ] || die "source origin is $origin, expected $expected_repository"
  [ -z "$(git -C "$source_dir" status --porcelain --untracked-files=all)" ] || die "source clone is not clean"

  remote_line="$(GIT_TERMINAL_PROMPT=0 git ls-remote --exit-code "$expected_repository" refs/heads/main 2>/dev/null)" || \
    die "cannot read refs/heads/main from expected repository"
  remote_sha="${remote_line%%[[:space:]]*}"
  [ "$remote_sha" = "$expected_sha" ] || die "remote main moved to $remote_sha; expected $expected_sha"

  bash "$source_dir/scripts/check_source_only.sh" --tracked-only >/dev/null || \
    die "source-only policy failed in candidate clone"
  validate_source_boundaries
  [ -f "$source_dir/ops/workstation/content-agent-AGENTS.md" ] || \
    die "candidate source lacks the current content-agent policy"
}

validate_project() {
  local requested="$project_dir"
  project_dir="$(canonical_existing_dir "$project_dir")" || die "project directory is missing or symbolic: $requested"
  if [ "${ZNT_SYNC_TEST_MODE:-0}" != "1" ] && [ "$project_dir" != "$PRODUCTION_PROJECT_DIR" ]; then
    die "refusing non-production project path: $project_dir"
  fi
  [ -d "$project_dir/.git" ] && [ ! -L "$project_dir/.git" ] || die "project .git is missing or symbolic"
  [ -d "$project_dir/data/daily" ] && [ ! -L "$project_dir/data" ] && [ ! -L "$project_dir/data/daily" ] || \
    die "protected data/daily is missing or symbolic"
  [ -f "$project_dir/data/index.json" ] && [ -f "$project_dir/data/search-index.json" ] || \
    die "protected data indexes are missing"
  [ -d "$project_dir/public" ] && [ ! -L "$project_dir/public" ] || die "project public directory is missing or symbolic"
  [ -d "$project_dir/public/digest-images" ] && [ ! -L "$project_dir/public/digest-images" ] || \
    die "protected digest-images directory is missing or symbolic"
}

detect_content_activity() {
  local runtime_dir schedule_dir lock=""
  runtime_dir="${GROUP_DIGEST_RUNTIME:-$(read_dotenv_value "$project_dir/.env.local" GROUP_DIGEST_RUNTIME)}"
  runtime_dir="${runtime_dir:-$HOME/.group-digest-runtime}"
  schedule_dir="$runtime_dir/.schedule"

  if [ -d "$schedule_dir" ]; then
    while IFS= read -r -d '' lock; do
      die "content activity lock exists; leave it untouched and retry after the owner finishes: $lock"
    done < <(find -P "$schedule_dir" -maxdepth 1 \( -name '*.running' -o -name '*publish.lock' \) -print0)
  fi

  local active_processes=""
  if [ "${ZNT_SYNC_SKIP_PROCESS_CHECK:-0}" != "1" ]; then
    active_processes="$(node - "$project_dir" "$runtime_dir" <<'NODE'
const { execFileSync } = require("node:child_process");
const project = process.argv[2];
const runtime = process.argv[3];
const names = /(?:update_after_digest\.sh|deploy_vps\.sh|generate_daily(?:_from_essence)?\.py|extract_knowledge\.py|generate_(?:search_)?index\.py|sync_digest_images\.mjs)/;
let output = "";
try {
  output = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
} catch {
  process.exit(2);
}
for (const line of output.split(/\r?\n/)) {
  if (names.test(line) && (line.includes(project) || line.includes(runtime))) {
    process.stdout.write(`${line.trim()}\n`);
  }
}
NODE
    )" || die "could not inspect running content processes"
  fi
  [ -z "$active_processes" ] || die "content generation/publication process is still running: $active_processes"
}

validate_free_space() {
  local parent="$1"
  local minimum="${ZNT_SYNC_MIN_FREE_BYTES:-2147483648}"
  [[ "$minimum" =~ ^[0-9]+$ ]] || die "invalid ZNT_SYNC_MIN_FREE_BYTES: $minimum"
  node - "$parent" "$minimum" <<'NODE'
const fs = require("node:fs");
const target = process.argv[2];
const minimum = BigInt(process.argv[3]);
if (typeof fs.statfsSync !== "function") process.exit(0);
const stat = fs.statfsSync(target, { bigint: true });
const available = stat.bavail * stat.bsize;
if (available < minimum) {
  console.error(`source sync: only ${available} bytes free; require at least ${minimum}`);
  process.exit(1);
}
NODE
}

last_phase() {
  local journal="$1"
  [ -f "$journal" ] || return 0
  awk -F '\t' '$1 == "PHASE" { value=$2 } END { print value }' "$journal"
}

ensure_no_incomplete_transaction() {
  local journal phase
  [ -d "$backup_root" ] || return 0
  for journal in "$backup_root"/migration-*/journal; do
    [ -f "$journal" ] || continue
    phase="$(last_phase "$journal")"
    case "$phase" in
      COMPLETE|ROLLED_BACK|ABORTED_BEFORE_MUTATION) ;;
      *) die "incomplete migration found at $(dirname "$journal"); run --recover first" ;;
    esac
  done
}

old_path_was_present() {
  local relative="$1"
  awk -F '\t' -v wanted="$relative" '$1 == wanted { print $2; exit }' "$transaction_dir/old-paths.tsv"
}

rollback_transaction() {
  local relative old_present failed_root protected_now recovery_error=0
  [ -n "$transaction_dir" ] && [ -d "$transaction_dir" ] || return 1
  [ -f "$transaction_dir/project-path" ] || return 1
  IFS= read -r project_dir < "$transaction_dir/project-path"
  failed_root="$transaction_dir/failed-tree"
  mkdir -p "$failed_root"
  note "restoring previous source from $transaction_dir"

  for relative in "${install_paths[@]}" "${quarantine_paths[@]}"; do
    old_present="$(old_path_was_present "$relative")"
    if path_exists "$transaction_dir/old-tree/$relative"; then
      if path_exists "$project_dir/$relative"; then
        record_action "ROLLBACK_NEW" "$relative"
        move_path "$project_dir/$relative" "$failed_root/$relative" || recovery_error=1
      fi
      if ! path_exists "$project_dir/$relative"; then
        record_action "ROLLBACK_OLD" "$relative"
        move_path "$transaction_dir/old-tree/$relative" "$project_dir/$relative" || recovery_error=1
      fi
    elif [ "$old_present" = "0" ] && path_exists "$project_dir/$relative"; then
      record_action "ROLLBACK_NEW" "$relative"
      move_path "$project_dir/$relative" "$failed_root/$relative" || recovery_error=1
    elif [ "$old_present" = "1" ] && ! path_exists "$project_dir/$relative"; then
      echo "source sync: cannot find previous path during recovery: $relative" >&2
      recovery_error=1
    fi
  done

  protected_now="$transaction_dir/protected.recovered.json"
  if ! manifest_protected "$project_dir" "$protected_now"; then
    recovery_error=1
  elif ! cmp -s "$transaction_dir/protected.before.json" "$protected_now"; then
    echo "source sync: protected content changed during the failed transaction; it was not overwritten" >&2
    recovery_error=1
  fi

  if [ "$recovery_error" -eq 0 ]; then
    write_phase "ROLLED_BACK"
    note "previous source restored; failed candidate retained at $failed_root"
    return 0
  fi
  write_phase "RECOVERY_NEEDS_ATTENTION"
  return 1
}

handle_exit() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [ "$status" -ne 0 ] && [ "$mutation_started" = true ] && [ "$transaction_complete" = false ]; then
    rollback_transaction || true
  elif [ "$status" -ne 0 ] && [ -n "$transaction_dir" ] && [ -d "$transaction_dir" ] && [ "$transaction_complete" = false ]; then
    write_phase "ABORTED_BEFORE_MUTATION" || true
  fi
  exit "$status"
}

mutation_checkpoint() {
  local count_file="$transaction_dir/mutation-count"
  local count=0 fail_after="${ZNT_SYNC_FAIL_AFTER_MUTATION:-0}"
  if [ -f "$count_file" ]; then
    IFS= read -r count < "$count_file"
  fi
  count=$((count + 1))
  printf '%s\n' "$count" > "$count_file"
  if [[ "$fail_after" =~ ^[0-9]+$ ]] && [ "$fail_after" -gt 0 ] && [ "$count" -ge "$fail_after" ]; then
    die "injected failure after mutation $count"
  fi
}

prepare_transaction() {
  local timestamp old_head relative present backup_parent candidate
  timestamp="$(date -u '+%Y%m%dT%H%M%SZ')"
  old_head="$(git -C "$project_dir" rev-parse --short=12 HEAD 2>/dev/null || printf unknown)"
  transaction_dir="$backup_root/migration-${timestamp}-${old_head}-to-${expected_sha:0:12}"
  [ ! -e "$transaction_dir" ] || die "backup collision: $transaction_dir"
  mkdir -p "$transaction_dir/old-tree" "$transaction_dir/candidate-tree"
  chmod 700 "$transaction_dir"
  printf '%s\n' "$project_dir" > "$transaction_dir/project-path"
  printf '%s\n' "$expected_sha" > "$transaction_dir/expected-sha"
  : > "$transaction_dir/journal"
  write_phase "PREPARING"

  git -C "$project_dir" status --porcelain=v2 --branch > "$transaction_dir/git-status.before.txt"
  git -C "$project_dir" remote -v > "$transaction_dir/git-remotes.before.txt"
  git -C "$project_dir" ls-files -s > "$transaction_dir/git-files.before.txt"
  git -C "$project_dir" diff --binary > "$transaction_dir/git-worktree.before.patch"
  git -C "$project_dir" diff --binary --cached > "$transaction_dir/git-index.before.patch"
  git -C "$project_dir" bundle create "$transaction_dir/git-history.before.bundle" --all >/dev/null
  manifest_protected "$project_dir" "$transaction_dir/protected.before.json"

  : > "$transaction_dir/old-paths.tsv"
  for relative in "${install_paths[@]}" "${quarantine_paths[@]}"; do
    present=0
    path_exists "$project_dir/$relative" && present=1
    printf '%s\t%s\n' "$relative" "$present" >> "$transaction_dir/old-paths.tsv"
  done

  candidate="$transaction_dir/candidate-tree"
  for relative in "${install_paths[@]}"; do
    path_exists "$source_dir/$relative" || continue
    copy_path "$source_dir/$relative" "$candidate/$relative"
  done
  write_phase "PREPARED"
  note "rollback material prepared at $transaction_dir"
}

apply_transaction() {
  local relative candidate="$transaction_dir/candidate-tree"
  mutation_started=true
  write_phase "MOVING_OLD_SOURCE"
  for relative in "${install_paths[@]}" "${quarantine_paths[@]}"; do
    path_exists "$project_dir/$relative" || continue
    record_action "MOVE_OLD" "$relative"
    move_path "$project_dir/$relative" "$transaction_dir/old-tree/$relative"
    mutation_checkpoint
  done

  write_phase "INSTALLING_NEW_SOURCE"
  for relative in "${install_paths[@]}"; do
    path_exists "$candidate/$relative" || continue
    record_action "INSTALL_NEW" "$relative"
    move_path "$candidate/$relative" "$project_dir/$relative"
    mutation_checkpoint
  done

  record_action "INSTALL_LOCAL_POLICY" "AGENTS.md"
  cp "$project_dir/ops/workstation/content-agent-AGENTS.md" "$project_dir/AGENTS.md"
  chmod 600 "$project_dir/AGENTS.md"
  mutation_checkpoint
  write_phase "VERIFYING"
}

verify_applied_transaction() {
  local actual
  manifest_protected "$project_dir" "$transaction_dir/protected.after.json"
  cmp -s "$transaction_dir/protected.before.json" "$transaction_dir/protected.after.json" || \
    die "protected data, images or environment files changed during source migration"

  actual="$(git -C "$project_dir" rev-parse HEAD)"
  [ "$actual" = "$expected_sha" ] || die "installed HEAD is $actual, expected $expected_sha"
  [ "$(git -C "$project_dir" branch --show-current)" = "main" ] || die "installed branch is not main"
  [ "$(git -C "$project_dir" remote get-url origin)" = "$expected_repository" ] || die "installed origin is unexpected"
  [ -z "$(git -C "$project_dir" status --porcelain --untracked-files=all)" ] || die "installed source tree is not clean"
  [ -z "$(git -C "$project_dir" ls-files -- data public/digest-images)" ] || die "protected content is tracked by the new Git repository"
  bash "$project_dir/scripts/check_source_only.sh" --tracked-only >/dev/null || die "installed source-only policy failed"
  cmp -s "$project_dir/ops/workstation/content-agent-AGENTS.md" "$project_dir/AGENTS.md" || \
    die "local content-agent policy was not installed exactly"
  for actual in .vercelignore .vercel .claude .agents .codex .memory .znt-build-home; do
    if path_exists "$project_dir/$actual"; then
      die "retired local metadata remains active: $actual"
    fi
  done
}

run_recovery() {
  transaction_dir="$(canonical_existing_dir "$recovery_dir")" || die "recovery directory is missing or symbolic: $recovery_dir"
  [ -f "$transaction_dir/journal" ] && [ -f "$transaction_dir/old-paths.tsv" ] || die "not a source migration backup: $transaction_dir"
  [ -f "$transaction_dir/project-path" ] || die "migration backup has no project path"
  IFS= read -r project_dir < "$transaction_dir/project-path"
  project_dir="$(canonical_existing_dir "$project_dir")" || die "recovery project is missing or symbolic: $project_dir"
  if [ "${ZNT_SYNC_TEST_MODE:-0}" != "1" ] && [ "$project_dir" != "$PRODUCTION_PROJECT_DIR" ]; then
    die "refusing to recover a non-production project path: $project_dir"
  fi
  case "$(last_phase "$transaction_dir/journal")" in
    COMPLETE) die "migration already completed; automatic recovery is not permitted" ;;
    ROLLED_BACK) note "migration was already rolled back: $transaction_dir"; return 0 ;;
    ABORTED_BEFORE_MUTATION) note "migration stopped before modifying source: $transaction_dir"; return 0 ;;
  esac
  rollback_transaction || die "recovery needs manual attention; no protected path was intentionally modified"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) [ -z "$mode" ] || die "choose exactly one mode"; mode="dry-run"; shift ;;
    --apply) [ -z "$mode" ] || die "choose exactly one mode"; mode="apply"; shift ;;
    --recover) [ -z "$mode" ] || die "choose exactly one mode"; mode="recover"; recovery_dir="${2:-}"; [ -n "$recovery_dir" ] || die "--recover requires a directory"; shift 2 ;;
    --confirm-content-paused) content_paused=true; shift ;;
    --project-dir) project_dir="${2:-}"; [ -n "$project_dir" ] || die "--project-dir requires a path"; shift 2 ;;
    --source-dir) source_dir="${2:-}"; [ -n "$source_dir" ] || die "--source-dir requires a path"; shift 2 ;;
    --repository) expected_repository="${2:-}"; [ -n "$expected_repository" ] || die "--repository requires a URL"; shift 2 ;;
    --expected-sha) expected_sha="${2:-}"; [ -n "$expected_sha" ] || die "--expected-sha requires a SHA"; shift 2 ;;
    --backup-root) backup_root="${2:-}"; [ -n "$backup_root" ] || die "--backup-root requires a path"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$mode" ] || { usage >&2; exit 2; }
if [ "$mode" = "recover" ]; then
  run_recovery
  exit 0
fi

[[ "$expected_sha" =~ ^[0-9a-f]{40}$ ]] || die "--expected-sha must be a full lowercase 40-character SHA"
validate_project
validate_source
detect_content_activity

if [ -z "$backup_root" ]; then
  backup_root="$(dirname "$project_dir")/znt-source-migration-backups"
fi
if [ -e "$backup_root" ]; then
  [ -d "$backup_root" ] && [ ! -L "$backup_root" ] || die "backup root is not a regular directory: $backup_root"
  backup_root="$(canonical_existing_dir "$backup_root")"
  ensure_no_incomplete_transaction
  validate_free_space "$backup_root"
else
  local_parent="$(canonical_existing_dir "$(dirname "$backup_root")")" || die "backup parent does not exist"
  backup_root="$local_parent/$(basename "$backup_root")"
  validate_free_space "$local_parent"
fi
case "$backup_root/" in
  "$project_dir"/*) die "backup root cannot be inside the production project" ;;
esac

temporary_manifest="$(mktemp "${TMPDIR:-/tmp}/znt-protected.XXXXXX")"
trap 'rm -f "$temporary_manifest"' EXIT
manifest_protected "$project_dir" "$temporary_manifest"

if [ "$mode" = "dry-run" ]; then
  note "dry-run passed"
  note "project=$project_dir"
  note "source=$source_dir"
  note "target=$expected_sha"
  note "backup=$backup_root"
  note "protected entries=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).length)' "$temporary_manifest")"
  exit 0
fi

[ "$content_paused" = true ] || die "apply requires --confirm-content-paused after pausing content generation and publication"
mkdir -p "$backup_root"
chmod 700 "$backup_root"

# Atomic moves are only guaranteed when the project and backup share a device.
[ "$(node -e 'console.log(require("fs").statSync(process.argv[1]).dev)' "$project_dir")" = \
  "$(node -e 'console.log(require("fs").statSync(process.argv[1]).dev)' "$backup_root")" ] || \
  die "backup root must be on the same filesystem as the production project"

rm -f "$temporary_manifest"
trap handle_exit EXIT
trap 'exit 130' HUP INT TERM
prepare_transaction
apply_transaction
verify_applied_transaction
write_phase "COMPLETE"
transaction_complete=true
note "source migration complete"
note "HEAD=$expected_sha"
note "rollback backup=$transaction_dir"
note "no content was generated or published"
