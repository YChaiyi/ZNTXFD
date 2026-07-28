#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESTINATION="${1:-$(mktemp -d "${TMPDIR:-/tmp}/znt-source.XXXXXX")}"

fail() {
  echo "create_source_only_tree: $*" >&2
  exit 1
}

canonicalize_destination() {
  local candidate="$1"
  local suffix=""

  while [[ ! -e "$candidate" ]]; do
    suffix="/$(basename "$candidate")$suffix"
    candidate="$(dirname "$candidate")"
  done
  [[ -d "$candidate" ]] || fail "destination parent is not a directory"
  printf '%s%s\n' "$(cd "$candidate" && pwd -P)" "$suffix"
}

DESTINATION="$(canonicalize_destination "$DESTINATION")"
[[ "$DESTINATION" != "/" ]] || fail "destination must not be the filesystem root"
case "$DESTINATION/" in
  "$PROJECT_DIR/"*) fail "destination must be outside the project root" ;;
esac
if [[ -e "$DESTINATION" ]]; then
  [[ -d "$DESTINATION" ]] || fail "destination is not a directory"
  [[ -z "$(find "$DESTINATION" -mindepth 1 -maxdepth 1 -print -quit)" ]] || fail "destination must be empty"
else
  mkdir -p "$DESTINATION"
fi

rsync -a \
  --include='/.env.example' \
  --exclude='**/.env*' \
  --exclude='**/.npmrc' \
  --exclude='**/node_modules/***' \
  --exclude='**/__pycache__/***' \
  --exclude='**/.next/***' \
  --exclude='**/.next-stale-*/***' \
  --exclude='**/.vercel/***' \
  --exclude='**/*.pyc' \
  --exclude='**/*.tsbuildinfo' \
  --exclude='**/*.pem' \
  --exclude='**/*.key' \
  --exclude='**/*.p12' \
  --exclude='**/*.pfx' \
  --exclude='**/*.db' \
  --exclude='**/*.sqlite' \
  --exclude='**/*.sqlite3' \
  --exclude='**/*.ods' \
  --exclude='**/*.log' \
  --exclude='**/*.zip' \
  --exclude='**/*.tar' \
  --exclude='**/*.tgz' \
  --exclude='**/*.tar.gz' \
  --exclude='**/*.7z' \
  --include='/.github/' \
  --include='/.github/workflows/***' \
  --include='/ops/***' \
  --include='/public/' \
  --include='/public/favicon.ico' \
  --include='/public/token-rank/***' \
  --include='/scripts/***' \
  --include='/src/***' \
  --include='/tests/***' \
  --include='/.gitignore' \
  --include='/LICENSE' \
  --include='/README.md' \
  --include='/eslint.config.mjs' \
  --include='/next-env.d.ts' \
  --include='/next.config.ts' \
  --include='/package-lock.json' \
  --include='/package.json' \
  --include='/postcss.config.mjs' \
  --include='/tailwind.config.ts' \
  --include='/tsconfig.json' \
  --exclude='*' \
  "$PROJECT_DIR/" "$DESTINATION/"

if find -P "$DESTINATION" -type l -print -quit | grep -q .; then
  fail "source allowlist contains a symbolic link"
fi
if find -P "$DESTINATION" ! -type d ! -type f -print -quit | grep -q .; then
  fail "source allowlist contains an unsupported filesystem entry"
fi

git -C "$DESTINATION" init -q
git -C "$DESTINATION" add -A
echo "$DESTINATION"
