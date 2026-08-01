#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$(cd "$SCRIPT_DIR/.." && pwd)"

tracked_only=false
source_max_files="${ZNT_SOURCE_MAX_FILES:-10000}"
source_max_bytes="${ZNT_SOURCE_MAX_BYTES:-67108864}"
if [ "${1:-}" = "--tracked-only" ]; then
  tracked_only=true
elif [ -n "${1:-}" ]; then
  echo "Usage: $0 [--tracked-only]" >&2
  exit 2
fi

if ! [[ "$source_max_files" =~ ^[0-9]+$ && "$source_max_files" -gt 0 ]]; then
  echo "Invalid source file-count limit" >&2
  exit 2
fi
if ! [[ "$source_max_bytes" =~ ^[0-9]+$ && "$source_max_bytes" -gt 0 ]]; then
  echo "Invalid source byte limit" >&2
  exit 2
fi

forbidden_tracked="$(git ls-files | grep -E '(^data/|^public/digest-images/|^AGENTS\.md$|^\.gitmodules$|^\.gitleaks(ignore|\.toml)$|(^|/)\.(agents|claude|codex|memory|logs|work|znt-build-home)/|(^|/)(node_modules|\.next|\.vercel)/|(^|/)\.env[^/]*$|(^|/)\.npmrc$|\.(pem|key|p12|pfx|db|sqlite|sqlite3|ods|log|zip|tar|tgz|tar\.gz|7z)$)' | grep -v '^\.env\.example$' || true)"
if [ -n "$forbidden_tracked" ]; then
  echo "Tracked files violate the source-only policy:" >&2
  echo "$forbidden_tracked" >&2
  exit 1
fi

unsupported_entries="$(git ls-files -s | awk '$1 == "120000" || $1 == "160000" { sub(/^[^\t]*\t/, ""); print }')"
if [ -n "$unsupported_entries" ]; then
  echo "Tracked symbolic links or submodules violate the source-only policy:" >&2
  echo "$unsupported_entries" >&2
  exit 1
fi

source_file_count=0
source_byte_count=0
while IFS= read -r -d '' source_file; do
  if [ ! -f "$source_file" ] || [ -L "$source_file" ]; then
    echo "Tracked source entry is not a regular file: $source_file" >&2
    exit 1
  fi
  file_bytes="$(wc -c < "$source_file" | tr -d '[:space:]')"
  [[ "$file_bytes" =~ ^[0-9]+$ ]] || {
    echo "Cannot measure tracked source file: $source_file" >&2
    exit 1
  }
  source_file_count=$((source_file_count + 1))
  source_byte_count=$((source_byte_count + file_bytes))
done < <(git ls-files -z)
if [ "$source_file_count" -gt "$source_max_files" ]; then
  echo "Tracked source exceeds the file-count limit: $source_file_count > $source_max_files" >&2
  exit 1
fi
if [ "$source_byte_count" -gt "$source_max_bytes" ]; then
  echo "Tracked source exceeds the byte limit: $source_byte_count > $source_max_bytes" >&2
  exit 1
fi

if git grep -nE '(^|[[:space:]])filter=lfs([[:space:]]|$)' -- '*.gitattributes'; then
  echo "Git LFS filters are not allowed in the source repository" >&2
  exit 1
fi
if git grep -Il '^version https://git-lfs.github.com/spec/v1$' -- .; then
  echo "Git LFS pointers are not allowed in the source repository" >&2
  exit 1
fi

if [ "$tracked_only" = false ]; then
  for forbidden_dir in data public/digest-images .agents .claude .codex .memory .logs .work .znt-build-home node_modules .next .vercel; do
    if [ -e "$forbidden_dir" ]; then
      echo "Source-only tree contains forbidden path: $forbidden_dir" >&2
      exit 1
    fi
  done
  if [ -e .npmrc ]; then
    echo "Source-only tree contains forbidden path: .npmrc" >&2
    exit 1
  fi
  if [ -e AGENTS.md ]; then
    echo "Source-only tree contains forbidden path: AGENTS.md" >&2
    exit 1
  fi
  while IFS= read -r environment_file; do
    if [ "$environment_file" != "./.env.example" ]; then
      echo "Source-only tree contains forbidden environment file: ${environment_file#./}" >&2
      exit 1
    fi
  done < <(find -P . -path './.git' -prune -o -name '.env*' -print)
  if find -P . -path './.git' -prune -o -type l -print -quit | grep -q .; then
    echo "Source-only tree contains a symbolic link" >&2
    exit 1
  fi
  if find -P . -path './.git' -prune -o -type f \( \
      -name '*.pem' -o -name '*.key' -o -name '*.p12' -o -name '*.pfx' \
      -o -name '*.db' -o -name '*.sqlite' -o -name '*.sqlite3' -o -name '*.ods' \
      -o -name '*.log' -o -name '*.zip' -o -name '*.tar' -o -name '*.tgz' \
      -o -name '*.tar.gz' -o -name '*.7z' \) -print -quit | grep -q .; then
    echo "Source-only tree contains a secret, database, log, or archive file" >&2
    exit 1
  fi
fi

if git grep -nE 'BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}' -- . ':!package-lock.json'; then
  echo "Potential secret detected in tracked source" >&2
  exit 1
fi

if git grep -nE 'vercel (build|deploy)|npx vercel|rsync[^\n]*--delete[^\n]*/var/www/znt\.group/current' -- . \
    ':!scripts/check_source_only.sh' ':!ops/workstation/content-agent-AGENTS.md'; then
  echo "Retired deployment capability detected" >&2
  exit 1
fi

# The daily workstation is allowed to publish content only through the
# zntcontent forced-command protocol. Any direct production administration in
# scripts/ can restore the legacy whole-tree deployment path and overwrite the
# active code release.
if git grep -nE 'ubuntu@|sudo([[:space:]]|$)|systemctl([[:space:]]|$)|znt-(rollback|code-deploy|content-promote)|/var/www/znt\.group/current' -- scripts ':!scripts/check_source_only.sh'; then
  echo "Legacy workstation deployment capability detected" >&2
  exit 1
fi

echo "source-only policy passed"
