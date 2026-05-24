#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DOCS_DIR="$ROOT_DIR/apps/docs"
WEB_DIR="$ROOT_DIR/apps/web"

echo "Building docs export with /docs base path..."
(
  cd "$ROOT_DIR"
  DOCS_BASE_PATH=/docs bun run turbo run build --filter=@shipcode/docs
)

echo "Syncing exported docs into apps/web/public/docs..."
rm -rf "$WEB_DIR/public/docs"
mkdir -p "$WEB_DIR/public/docs"
cp -r "$DOCS_DIR/out/." "$WEB_DIR/public/docs/"

echo "Docs synced to $WEB_DIR/public/docs"
