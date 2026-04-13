#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

STAGED_FILES=$(
  git diff --cached --name-only --diff-filter=ACMR -- \
    '*.js' '*.jsx' '*.ts' '*.tsx' '*.mjs' '*.cjs' '*.mts' '*.cts' \
    '*.json' '*.jsonc'
)

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

echo "Running Biome on staged files..."

# shellcheck disable=SC2086
bunx biome check --write $STAGED_FILES

echo "$STAGED_FILES" | while IFS= read -r file; do
  if [ -n "$file" ]; then
    git add -- "$file"
  fi
done
