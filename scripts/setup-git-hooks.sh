#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

git -C "$ROOT_DIR" config core.hooksPath "$ROOT_DIR/.githooks"

echo "Configured core.hooksPath -> $ROOT_DIR/.githooks"
