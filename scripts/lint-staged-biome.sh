#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

hydrate_path_from_login_shell() {
  for shell_path in "${SHELL:-}" /bin/zsh /bin/bash; do
    if [ -z "${shell_path:-}" ] || [ ! -x "$shell_path" ]; then
      continue
    fi

    login_path=$("$shell_path" -ilc 'printf %s "$PATH"' 2>/dev/null || true)
    if [ -n "$login_path" ]; then
      PATH="$login_path"
      export PATH
      return 0
    fi
  done

  return 1
}

hydrate_path_from_login_shell || true

if [ -x "$ROOT_DIR/node_modules/.bin/biome" ]; then
  BIOME_CMD="$ROOT_DIR/node_modules/.bin/biome"
elif command -v bunx >/dev/null 2>&1; then
  BIOME_CMD="bunx biome"
elif command -v npx >/dev/null 2>&1; then
  BIOME_CMD="npx @biomejs/biome"
else
  echo "Biome runner not found. Install dependencies or add bunx/npx to PATH." >&2
  exit 127
fi

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

if [ "$BIOME_CMD" = "$ROOT_DIR/node_modules/.bin/biome" ]; then
  xargs -0 "$BIOME_CMD" check --write <"$STAGED_FILES_FILE"
elif [ "$BIOME_CMD" = "bunx biome" ]; then
  xargs -0 bunx biome check --write <"$STAGED_FILES_FILE"
else
  xargs -0 npx @biomejs/biome check --write <"$STAGED_FILES_FILE"
fi
xargs -0 git add -- <"$STAGED_FILES_FILE"
