#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

STAGED_FILES_FILE=$(mktemp)
cleanup() {
  rm -f "$STAGED_FILES_FILE"
}
trap cleanup EXIT INT TERM

git diff --cached --name-only -z --diff-filter=ACMR -- \
  '*.js' '*.jsx' '*.ts' '*.tsx' '*.mjs' '*.cjs' '*.mts' '*.cts' \
  '*.json' '*.jsonc' >"$STAGED_FILES_FILE"

if [ ! -s "$STAGED_FILES_FILE" ]; then
  exit 0
fi

echo "Running Biome on staged files..."

xargs -0 bunx biome check --write <"$STAGED_FILES_FILE"
xargs -0 git add -- <"$STAGED_FILES_FILE"
