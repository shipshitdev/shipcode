#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DOCS_DIR="$ROOT_DIR/apps/docs"
WEB_DIR="$ROOT_DIR/apps/web"

echo "Building docs export with /docs base path..."
(
  cd "$ROOT_DIR"
  DOCS_BASE_PATH=/docs bun run turbo run build --filter=@shipcode/docs --force
)

echo "Syncing exported docs into apps/web/public/docs..."
rm -rf "$WEB_DIR/public/docs"
mkdir -p "$WEB_DIR/public/docs"
cp -r "$DOCS_DIR/out/." "$WEB_DIR/public/docs/"

if grep -R -E '(href|src)="/_next/' "$WEB_DIR/public/docs" >/dev/null; then
  echo "Docs export contains root-relative Next.js assets; expected /docs/_next assets." >&2
  exit 1
fi

echo "Docs synced to $WEB_DIR/public/docs"
