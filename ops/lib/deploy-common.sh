#!/bin/bash
# Shared helpers for root-owned znt deployment commands. Install this file as
# /usr/local/lib/znt/deploy-common.sh with owner root:root and mode 0755.

set -euo pipefail

ZNT_NODE_BIN="${ZNT_NODE_BIN:-/usr/local/bin/node}"
ZNT_NPM_BIN="${ZNT_NPM_BIN:-/usr/local/bin/npm}"
ZNT_NODE_MAJOR="${ZNT_NODE_MAJOR:-24}"
ZNT_GIT_BIN="${ZNT_GIT_BIN:-/usr/bin/git}"
ZNT_CHATTR_BIN="${ZNT_CHATTR_BIN:-/usr/bin/chattr}"
ZNT_LSATTR_BIN="${ZNT_LSATTR_BIN:-/usr/bin/lsattr}"
ZNT_CODE_MANIFEST_TOOL="${ZNT_CODE_MANIFEST_TOOL:-/usr/local/lib/znt/code-release-manifest.mjs}"
ZNT_SOURCE_REPOSITORY_URL="https://github.com/YChaiyi/ZNTXFD.git"
ZNT_SOURCE_MAX_FILES="${ZNT_SOURCE_MAX_FILES:-10000}"
ZNT_SOURCE_MAX_BYTES="${ZNT_SOURCE_MAX_BYTES:-67108864}"

znt_fail() {
  echo "znt-deploy: $*" >&2
  exit 1
}

znt_require_root() {
  [[ "${EUID}" -eq 0 ]] || znt_fail "this command must run as root"
}

znt_require_node_runtime() {
  local actual_major
  [[ -x "$ZNT_NODE_BIN" ]] || znt_fail "Node.js is missing: $ZNT_NODE_BIN"
  [[ -x "$ZNT_NPM_BIN" ]] || znt_fail "npm is missing: $ZNT_NPM_BIN"
  actual_major="$("$ZNT_NODE_BIN" -p 'process.versions.node.split(".")[0]')"
  [[ "$actual_major" = "$ZNT_NODE_MAJOR" ]] \
    || znt_fail "Node.js major must be $ZNT_NODE_MAJOR, found $actual_major at $ZNT_NODE_BIN"
}

znt_require_release_integrity_tools() {
  [[ -x "$ZNT_CHATTR_BIN" ]] || znt_fail "chattr is missing: $ZNT_CHATTR_BIN"
  [[ -x "$ZNT_LSATTR_BIN" ]] || znt_fail "lsattr is missing: $ZNT_LSATTR_BIN"
  [[ -f "$ZNT_CODE_MANIFEST_TOOL" && ! -L "$ZNT_CODE_MANIFEST_TOOL" ]] \
    || znt_fail "code release manifest tool is missing: $ZNT_CODE_MANIFEST_TOOL"
}

znt_code_release_is_immutable() {
  local release="$1"

  find -P "$release" -xdev \( -type d -o -type f \) -exec "$ZNT_LSATTR_BIN" -d -- {} + 2>/dev/null \
    | awk '$1 !~ /i/ { invalid=1 } END { exit(invalid ? 1 : 0) }'
}

znt_code_release_permissions_valid() {
  local release="$1"
  local invalid_owner invalid_mode

  invalid_owner="$(find -P "$release" -xdev \( ! -user root -o ! -group zntapp \) -print -quit)" \
    || return 1
  [[ -z "$invalid_owner" ]] || return 1
  invalid_mode="$(find -P "$release" -xdev \( -type d -o -type f \) -perm /022 -print -quit)" \
    || return 1
  [[ -z "$invalid_mode" ]]
}

znt_code_release_valid() {
  local release="$1"
  local expected_sha="$2"
  local owner mode manifest owner_manifest mode_manifest

  [[ -d "$release" && ! -L "$release" ]] || return 1
  owner="$(stat -c '%U:%G' "$release" 2>/dev/null)" || return 1
  mode="$(stat -c '%a' "$release" 2>/dev/null)" || return 1
  [[ "$owner" = "root:zntapp" ]] || return 1
  (( (8#$mode & 0022) == 0 )) || return 1
  znt_code_release_permissions_valid "$release" || return 1
  manifest="$release/.znt-code-release.json"
  [[ -f "$manifest" && ! -L "$manifest" ]] || return 1
  owner_manifest="$(stat -c '%U:%G' "$manifest" 2>/dev/null)" || return 1
  mode_manifest="$(stat -c '%a' "$manifest" 2>/dev/null)" || return 1
  [[ "$owner_manifest" = "root:zntapp" && "$mode_manifest" = "640" ]] || return 1
  "$ZNT_NODE_BIN" "$ZNT_CODE_MANIFEST_TOOL" verify "$release" "$expected_sha" >/dev/null 2>&1 \
    || return 1
  znt_code_release_is_immutable "$release"
}

znt_seal_code_release() {
  local release="$1"
  local expected_sha="$2"
  local manifest="$release/.znt-code-release.json"
  local status=0

  znt_require_release_integrity_tools
  [[ -d "$release" && ! -L "$release" ]] || znt_fail "cannot seal an invalid code release"
  [[ "$(stat -c '%U:%G' "$release")" = "root:zntapp" ]] \
    || znt_fail "code release must be owned by root:zntapp before sealing"
  "$ZNT_NODE_BIN" "$ZNT_CODE_MANIFEST_TOOL" create "$release" "$expected_sha" \
    || znt_fail "could not create the code release manifest"
  chown root:zntapp "$manifest" || status=$?
  (( status != 0 )) || chmod 0640 "$manifest" || status=$?
  (( status != 0 )) \
    || find -P "$release" -xdev \( -type d -o -type f \) -exec "$ZNT_CHATTR_BIN" +i -- {} + \
    || status=$?
  (( status != 0 )) || znt_code_release_valid "$release" "$expected_sha" || status=$?
  if (( status != 0 )); then
    znt_unseal_code_release "$release" || true
    rm -f -- "$manifest" || true
    znt_fail "sealed code release failed integrity verification; the partial seal was removed"
  fi
}

znt_unseal_code_release() {
  local release="$1"

  [[ -d "$release" && ! -L "$release" ]] || return 0
  [[ -x "$ZNT_CHATTR_BIN" ]] || return 1
  find -P "$release" -xdev \( -type d -o -type f \) -exec "$ZNT_CHATTR_BIN" -i -- {} +
}

znt_require_free_kib() {
  local path="$1"
  local minimum="${2:-12582912}"
  local available

  [[ "$minimum" =~ ^[0-9]+$ ]] || znt_fail "invalid reserved disk-space threshold"
  available="$(df -Pk "$path" | awk 'END { print $4 }')"
  [[ "$available" =~ ^[0-9]+$ && "$available" -ge "$minimum" ]] \
    || znt_fail "insufficient reserved disk space"
}

znt_stop_active_build_unit() {
  local unit="${ZNT_ACTIVE_BUILD_UNIT:-}"

  [[ -n "$unit" ]] || return 0
  unset ZNT_ACTIVE_BUILD_UNIT
  /usr/bin/timeout --signal=KILL 20 systemctl stop "$unit" >/dev/null 2>&1 || true
  systemctl kill --kill-whom=all --signal=KILL "$unit" >/dev/null 2>&1 || true
  systemctl reset-failed "$unit" >/dev/null 2>&1 || true
}

znt_cleanup_stale_build_units() {
  /usr/bin/timeout --signal=KILL 20 systemctl stop 'znt-build-*' >/dev/null 2>&1 || true
  systemctl kill --kill-whom=all --signal=KILL 'znt-build-*' >/dev/null 2>&1 || true
  systemctl reset-failed 'znt-build-*' >/dev/null 2>&1 || true
}

znt_run_isolated_build() {
  local root="$1"
  local workdir="$2"
  local network_mode="$3"
  shift 3
  local unit="znt-build-$$-$RANDOM"
  local build_home="$workdir/.znt-build-home"
  local status=0
  local -a network_property=()

  [[ -x /usr/bin/systemd-run ]] || znt_fail "systemd-run is required for isolated builds"
  [[ -d "$workdir" && ! -L "$workdir" ]] || znt_fail "isolated build directory is invalid"
  install -d -o zntdeploy -g zntdeploy -m 0700 "$build_home"
  case "$network_mode" in
    download) ;;
    offline) network_property+=(--property=PrivateNetwork=yes) ;;
    *) znt_fail "invalid isolated build network mode: $network_mode" ;;
  esac

  ZNT_ACTIVE_BUILD_UNIT="$unit"
  (
    # The parent keeps the deployment lock. The systemd-run client must not
    # inherit it, otherwise an orphaned client could prevent the next release
    # from acquiring the lock and cleaning its stale transient unit.
    if [[ -n "${ZNT_ACTIVE_LOCK_FD:-}" ]]; then
      exec {ZNT_ACTIVE_LOCK_FD}>&-
    fi
    /usr/bin/systemd-run \
      --quiet \
      --wait \
      --pipe \
      --collect \
      --unit="$unit" \
      --slice=znt-build.slice \
      --uid=zntdeploy \
      --gid=zntdeploy \
      --property="WorkingDirectory=$workdir" \
      --property=NoNewPrivileges=yes \
      --property=PrivateTmp=yes \
      --property=PrivateDevices=yes \
      --property=ProtectSystem=strict \
      --property=ProtectHome=yes \
      --property=ProtectProc=invisible \
      --property=ProcSubset=pid \
      --property=RestrictSUIDSGID=yes \
      --property=LockPersonality=yes \
      --property=UMask=0077 \
      --property=MemoryMax=2G \
      --property=TasksMax=256 \
      --property=RuntimeMaxSec=1800 \
      --property=LimitFSIZE=536870912 \
      --property="ReadWritePaths=$workdir" \
      --property="InaccessiblePaths=$root/current $root/shared" \
      "${network_property[@]}" \
      -- /usr/bin/env -i \
        HOME="$build_home" USER=zntdeploy LOGNAME=zntdeploy \
        PATH=/usr/local/bin:/usr/bin:/bin CI=1 \
        "$@"
  ) || status=$?
  if (( status != 0 )); then
    znt_stop_active_build_unit
    return "$status"
  fi
  unset ZNT_ACTIVE_BUILD_UNIT
  systemctl reset-failed "$unit" >/dev/null 2>&1 || true
  return 0
}

znt_public_main_sha() {
  local root="$1"
  local workdir="$2"
  local output_file="$workdir/.znt-public-main.$$.$RANDOM"
  local output sha ref extra

  [[ -x "$ZNT_GIT_BIN" ]] || znt_fail "Git is missing: $ZNT_GIT_BIN"
  znt_run_isolated_build "$root" "$workdir" download \
    /usr/bin/env \
      GIT_CONFIG_NOSYSTEM=1 \
      GIT_CONFIG_GLOBAL=/dev/null \
      GIT_TERMINAL_PROMPT=0 \
      GIT_ASKPASS=/bin/false \
      GIT_LFS_SKIP_SMUDGE=1 \
      GIT_PROTOCOL_FROM_USER=0 \
      "$ZNT_GIT_BIN" \
      -c credential.helper= \
      -c core.hooksPath=/dev/null \
      ls-remote --exit-code "$ZNT_SOURCE_REPOSITORY_URL" refs/heads/main \
      > "$output_file" \
    || znt_fail "cannot resolve the public GitHub main branch"
  output="$(<"$output_file")"
  rm -f -- "$output_file"
  read -r sha ref extra <<< "$output"
  [[ "$sha" =~ ^[0-9a-f]{40}$ && "$ref" = "refs/heads/main" && -z "${extra:-}" ]] \
    || znt_fail "public GitHub main returned an invalid ref"
  ZNT_PUBLIC_MAIN_SHA="$sha"
}

znt_assert_public_main() {
  local root="$1"
  local workdir="$2"
  local expected_sha="$3"
  local actual_sha

  [[ "$expected_sha" =~ ^[0-9a-f]{40}$ ]] || znt_fail "invalid requested Git SHA"
  znt_public_main_sha "$root" "$workdir"
  actual_sha="$ZNT_PUBLIC_MAIN_SHA"
  [[ "$actual_sha" = "$expected_sha" ]] \
    || znt_fail "requested SHA is not the current YChaiyi/ZNTXFD main (current: $actual_sha)"
}

znt_assert_source_tree_budget() {
  local tree="$1"
  local count bytes extra statistics

  [[ "$ZNT_SOURCE_MAX_FILES" =~ ^[0-9]+$ && "$ZNT_SOURCE_MAX_FILES" -gt 0 ]] \
    || znt_fail "invalid source file-count limit"
  [[ "$ZNT_SOURCE_MAX_BYTES" =~ ^[0-9]+$ && "$ZNT_SOURCE_MAX_BYTES" -gt 0 ]] \
    || znt_fail "invalid source byte limit"
  statistics="$(
    find -P "$tree" -xdev -type f -printf '%s\n' \
      | awk '{ count += 1; bytes += $1 } END { printf "%d %d\n", count, bytes }'
  )" || znt_fail "cannot measure the source checkout"
  read -r count bytes extra <<< "$statistics"
  [[ "$count" =~ ^[0-9]+$ && "$bytes" =~ ^[0-9]+$ && -z "${extra:-}" ]] \
    || znt_fail "source checkout size is invalid"
  [[ "$count" -le "$ZNT_SOURCE_MAX_FILES" ]] \
    || znt_fail "source checkout exceeds the file-count limit"
  [[ "$bytes" -le "$ZNT_SOURCE_MAX_BYTES" ]] \
    || znt_fail "source checkout exceeds the byte limit"
}

znt_clone_verified_public_main() {
  local root="$1"
  local workspace="$2"
  local expected_sha="$3"
  local checkout="$workspace/source"
  local metadata_file="$workspace/.znt-git-metadata"
  local commit_lines head_sha local_main origin_main origin_url
  local -a commits=()

  [[ "$expected_sha" =~ ^[0-9a-f]{40}$ ]] || znt_fail "invalid requested Git SHA"
  [[ -x "$ZNT_GIT_BIN" ]] || znt_fail "Git is missing: $ZNT_GIT_BIN"
  [[ -d "$workspace" && ! -L "$workspace" && ! -e "$checkout" ]] \
    || znt_fail "source clone workspace is invalid"

  znt_run_isolated_build "$root" "$workspace" download \
    /usr/bin/env \
      GIT_CONFIG_NOSYSTEM=1 \
      GIT_CONFIG_GLOBAL=/dev/null \
      GIT_TERMINAL_PROMPT=0 \
      GIT_ASKPASS=/bin/false \
      GIT_LFS_SKIP_SMUDGE=1 \
      GIT_PROTOCOL_FROM_USER=0 \
      "$ZNT_GIT_BIN" \
      -c credential.helper= \
      -c core.hooksPath=/dev/null \
      -c protocol.file.allow=never \
      clone --quiet --no-tags --depth=1 --single-branch --branch main -- \
        "$ZNT_SOURCE_REPOSITORY_URL" "$checkout"

  znt_run_isolated_build "$root" "$workspace" download \
    /usr/bin/env GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
      "$ZNT_GIT_BIN" -C "$checkout" rev-parse \
        'HEAD^{commit}' 'refs/heads/main^{commit}' 'refs/remotes/origin/main^{commit}' \
    > "$metadata_file"
  commit_lines="$(<"$metadata_file")"
  mapfile -t commits <<< "$commit_lines"
  (( ${#commits[@]} == 3 )) || znt_fail "cloned repository returned unexpected commit metadata"
  head_sha="${commits[0]}"
  local_main="${commits[1]}"
  origin_main="${commits[2]}"
  [[ "$head_sha" = "$expected_sha" && "$local_main" = "$expected_sha" && "$origin_main" = "$expected_sha" ]] \
    || znt_fail "cloned GitHub main does not match the requested SHA"
  znt_run_isolated_build "$root" "$workspace" download \
    /usr/bin/env GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
      "$ZNT_GIT_BIN" -C "$checkout" config --get remote.origin.url \
    > "$metadata_file"
  origin_url="$(<"$metadata_file")"
  [[ "$origin_url" = "$ZNT_SOURCE_REPOSITORY_URL" ]] \
    || znt_fail "cloned repository origin is not the fixed public GitHub repository"

  znt_run_isolated_build "$root" "$workspace" download \
    /usr/bin/env GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
      "$ZNT_GIT_BIN" -C "$checkout" ls-files --stage \
    > "$metadata_file"
  if awk '$1 == "160000" { found=1 } END { exit(found ? 0 : 1) }' "$metadata_file"; then
    znt_fail "source repository contains a submodule"
  fi

  znt_assert_public_main "$root" "$workspace" "$expected_sha"
  rm -rf -- "$checkout/.git" "$workspace/.znt-build-home"
  rm -f -- "$metadata_file"
  [[ ! -e "$checkout/.git" ]] || znt_fail "could not remove source repository metadata"
  if find -P "$checkout" -xdev ! -type d ! -type f -print -quit | grep -q .; then
    znt_fail "source checkout contains a link or unsupported filesystem entry"
  fi
  znt_assert_source_tree_budget "$checkout"
  if find -P "$checkout" -xdev -type f -name '.gitattributes' \
      -exec grep -El '(^|[[:space:]])filter=lfs([[:space:]]|$)' {} + | grep -q .; then
    znt_fail "source repository uses Git LFS"
  fi
  if find -P "$checkout" -xdev -type f \
      -exec grep -Il '^version https://git-lfs.github.com/spec/v1$' {} + | grep -q .; then
    znt_fail "source repository contains a Git LFS pointer"
  fi
}

znt_realpath() {
  readlink -f -- "$1" 2>/dev/null || znt_fail "cannot resolve path: $1"
}

znt_path_is_direct_child() {
  local parent="$1"
  local child="$2"
  local parent_real child_real relative
  parent_real="$(znt_realpath "$parent")"
  child_real="$(znt_realpath "$child")"
  relative="${child_real#"$parent_real"/}"
  [[ "$child_real" != "$parent_real" && "$relative" != "$child_real" && "$relative" != */* ]]
}

znt_lock_acquire() {
  local root="$1"
  local operation="$2"
  local wait_seconds="${ZNT_DEPLOY_LOCK_WAIT_SECONDS:-0}"
  local lock_file="$root/shared/.deploy.lock"
  local owner_file="$root/shared/.deploy.lock.owner"
  local owner=""

  [[ "$wait_seconds" =~ ^[0-9]+$ ]] || znt_fail "invalid deployment lock wait time"
  [[ -x /usr/bin/flock ]] || znt_fail "flock is required for deployment locking"
  mkdir -p "$(dirname "$lock_file")"
  [[ ! -d "$lock_file" ]] || znt_fail "legacy deployment lock directory must be removed after confirming no release is active"
  umask 077
  exec {ZNT_ACTIVE_LOCK_FD}>"$lock_file"
  if ! /usr/bin/flock -w "$wait_seconds" "$ZNT_ACTIVE_LOCK_FD"; then
    owner="$(tr '\n' ' ' < "$owner_file" 2>/dev/null || true)"
    exec {ZNT_ACTIVE_LOCK_FD}>&-
    unset ZNT_ACTIVE_LOCK_FD
    znt_fail "deployment lock is active${owner:+ ($owner)}"
  fi
  ZNT_ACTIVE_LOCK_OWNER="$owner_file"
  printf 'pid=%s\ntimestamp=%s\noperation=%s\n' "$$" "$(date +%s)" "$operation" > "$owner_file"
}

znt_lock_release() {
  znt_stop_active_build_unit
  if [[ -n "${ZNT_ACTIVE_LOCK_FD:-}" ]]; then
    if [[ -n "${ZNT_ACTIVE_LOCK_OWNER:-}" ]]; then
      rm -f -- "$ZNT_ACTIVE_LOCK_OWNER" \
        || echo "znt-deploy: warning: could not remove deployment lock metadata" >&2
    fi
    /usr/bin/flock -u "$ZNT_ACTIVE_LOCK_FD" \
      || echo "znt-deploy: warning: could not unlock deployment lock" >&2
    exec {ZNT_ACTIVE_LOCK_FD}>&- \
      || echo "znt-deploy: warning: could not close deployment lock descriptor" >&2
  fi
  unset ZNT_ACTIVE_LOCK_FD ZNT_ACTIVE_LOCK_OWNER
  return 0
}

znt_manifest_value() {
  local manifest="$1"
  local field="$2"
  "$ZNT_NODE_BIN" - "$manifest" "$field" <<'NODE'
const fs = require("fs");
const [manifestPath, field] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const value = manifest[field];
if (typeof value !== "string" || !value) process.exit(1);
process.stdout.write(value);
NODE
}

znt_current_pair() {
  local root="$1"
  local code_path content_path code_sha content_version
  code_path="$(znt_realpath "$root/current")"
  content_path="$(znt_realpath "$root/shared/content/current")"
  code_sha="$(basename "$code_path")"
  [[ "$code_sha" =~ ^[0-9a-f]{40}$ ]] || znt_fail "active code release is not a 40-character SHA"
  [[ -d "$content_path" && -f "$content_path/manifest.json" ]] || znt_fail "active content release is invalid"
  content_version="$(znt_manifest_value "$content_path/manifest.json" contentVersion)" || znt_fail "active content manifest has no version"
  [[ "$content_version" =~ ^[A-Za-z0-9._-]+$ ]] || znt_fail "active content version is invalid"
  printf '%s\t%s\t%s\t%s\n' "$code_sha" "$code_path" "$content_version" "$content_path"
}

znt_switch_link() {
  local target="$1"
  local link="$2"
  local temporary="$(dirname "$link")/.${0##*/}.link.$$.${RANDOM}"
  ln -s "$target" "$temporary"
  mv -Tf "$temporary" "$link"
}

znt_assert_internal_symlinks() {
  local tree="$1"
  local root link target
  root="$(znt_realpath "$tree")"

  while IFS= read -r -d '' link; do
    target="$(readlink -f -- "$link" 2>/dev/null || true)"
    [[ -n "$target" && ( "$target" = "$root" || "$target" == "$root/"* ) ]] \
      || znt_fail "symbolic link escapes its release tree: ${link#$root/}"
  done < <(find -P "$root" -xdev -type l -print0)
}

znt_write_state() {
  local state_path="$1"
  local code_sha="$2"
  local code_path="$3"
  local content_version="$4"
  local content_path="$5"
  local previous_code_sha="${6:-}"
  local previous_code_path="${7:-}"
  local previous_content_version="${8:-}"
  local previous_content_path="${9:-}"

  "$ZNT_NODE_BIN" - "$state_path" "$code_sha" "$code_path" "$content_version" "$content_path" \
    "$previous_code_sha" "$previous_code_path" "$previous_content_version" "$previous_content_path" <<'NODE'
const fs = require("fs");
const [
  statePath,
  codeSha,
  codePath,
  contentVersion,
  contentPath,
  previousCodeSha,
  previousCodePath,
  previousContentVersion,
  previousContentPath,
] = process.argv.slice(2);
const pair = (sha, sourcePath, version, dataPath) => ({
  codeSha: sha,
  codePath: sourcePath,
  contentVersion: version,
  contentPath: dataPath,
});
const previous = previousCodeSha && previousCodePath && previousContentVersion && previousContentPath
  ? pair(previousCodeSha, previousCodePath, previousContentVersion, previousContentPath)
  : null;
const next = {
  schemaVersion: 1,
  current: pair(codeSha, codePath, contentVersion, contentPath),
  previous,
  activatedAt: new Date().toISOString(),
};
const temporary = `${statePath}.${process.pid}.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o640 });
fs.renameSync(temporary, statePath);
NODE
}

znt_state_previous_pair() {
  local state_path="$1"
  "$ZNT_NODE_BIN" - "$state_path" <<'NODE'
const state = require(process.argv[2]);
const previous = state.previous;
if (!previous || !previous.codeSha || !previous.codePath || !previous.contentVersion || !previous.contentPath) process.exit(1);
console.log([previous.codeSha, previous.codePath, previous.contentVersion, previous.contentPath].join("\t"));
NODE
}

znt_validate_pair_paths() {
  local root="$1"
  local code_sha="$2"
  local code_path="$3"
  local content_version="$4"
  local content_path="$5"
  [[ "$code_sha" =~ ^[0-9a-f]{40}$ ]] || znt_fail "invalid code SHA in deployment state"
  [[ "$content_version" =~ ^[A-Za-z0-9._-]+$ ]] || znt_fail "invalid content version in deployment state"
  [[ "$(znt_realpath "$code_path")" = "$(znt_realpath "$root/releases/$code_sha")" ]] || znt_fail "code path is outside its release"
  [[ "$(znt_realpath "$content_path")" = "$(znt_realpath "$root/shared/content/releases/$content_version")" ]] || znt_fail "content path is outside its release"
}

znt_health_matches() {
  local expected_sha="$1"
  local expected_content_version="${2:-}"
  local response

  response="$(curl -fsS --max-time 5 -H 'X-ZNT-Local-Health: 1' http://127.0.0.1:3017/api/health)" \
    || return 1
  "$ZNT_NODE_BIN" -e '
    try {
      const [body, expectedSha, expectedContentVersion] = process.argv.slice(1);
      const health = JSON.parse(body);
      const valid = health.ready === true
        && health.buildSha === expectedSha
        && health.tokenRankUploadProtocol === 2
        && health.tokenRankPartialUpload === true
        && (!expectedContentVersion || health.contentVersion === expectedContentVersion);
      process.exit(valid ? 0 : 1);
    } catch {
      process.exit(1);
    }
  ' "$response" "$expected_sha" "$expected_content_version"
}

znt_start_and_check() {
  local service="$1"
  local expected_sha="$2"
  local root="${3:-${ZNT_ROOT:-/var/www/znt.group}}"
  local expected_content_version="${4:-}"
  local attempts="${ZNT_HEALTH_ATTEMPTS:-8}"
  local attempt release

  release="$(znt_realpath "$root/current")"
  znt_code_release_valid "$release" "$expected_sha" \
    || return 1
  systemctl start "$service"
  for attempt in $(seq 1 "$attempts"); do
    znt_health_matches "$expected_sha" "$expected_content_version" && return 0
    sleep 1
  done
  return 1
}

znt_content_smoke() {
  local expected_version="$1"
  local expected_sha="$2"
  local attempts="${ZNT_CONTENT_SMOKE_ATTEMPTS:-5}"
  local node_bin="$ZNT_NODE_BIN"
  local attempt

  [[ -x "$node_bin" ]] || return 1
  for attempt in $(seq 1 "$attempts"); do
    znt_health_matches "$expected_sha" "$expected_version" && return 0
    sleep 1
  done
  return 1
}

znt_prune_releases() {
  local releases="$1"
  local active_path="$2"
  local rollback_path="$3"
  local keep="$4"
  local marker_root="${5:-}"
  local kind="${6:-content}"
  local directory
  local -a candidates=()

  [[ "$keep" =~ ^[0-9]+$ ]] || znt_fail "invalid retention count"
  mapfile -t candidates < <(find "$releases" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf '%T@ %p\n' | sort -rn | awk -v keep="$keep" 'NR > keep { $1=""; sub(/^ /, ""); print }')
  for directory in "${candidates[@]}"; do
    [[ -n "$directory" ]] || continue
    [[ "$(znt_realpath "$directory")" = "$(znt_realpath "$active_path")" ]] && continue
    [[ -n "$rollback_path" && "$(znt_realpath "$directory")" = "$(znt_realpath "$rollback_path")" ]] && continue
    [[ -f "$directory/.migration-snapshot" ]] && continue
    [[ -n "$marker_root" && -f "$marker_root/$(basename "$directory")" ]] && continue
    if [[ "$kind" = "code" ]]; then
      znt_unseal_code_release "$directory" || {
        echo "znt-deploy: cannot unseal old code release: $directory" >&2
        continue
      }
    fi
    rm -rf -- "$directory"
  done
}
