#!/bin/sh
# check-native-elements.sh
# Fails if raw HTML elements are used instead of @shipshitdev/ui primitives.
#
# Exclusions:
#   - packages/ui/src/primitives/   (the primitives themselves)
#   - packages/ui/src/lib/          (utility code)
#   - **/*.test.tsx / **/*.test.ts  (test fixtures)
#   - apps/docs/                    (Nextra MDX)
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

VIOLATIONS=0

check() {
  pattern="$1"
  replacement="$2"

  # grep -P for Perl regex: match element start but not followed by uppercase (component names)
  # Falls back to basic grep if -P not available (macOS)
  matches=$(grep -rn "$pattern" \
    --include="*.tsx" \
    apps/desktop/src \
    packages/ui/src \
    apps/web/src \
    2>/dev/null \
    | grep -v "node_modules" \
    | grep -v "/dist/" \
    | grep -v "packages/ui/src/primitives/" \
    | grep -v "packages/ui/src/lib/" \
    | grep -v "\.test\." \
    | grep -v "apps/docs/" \
    | grep -v "^\s*//" \
    | grep -v "//.*$pattern" \
    | sed "s|^|  |" \
    || true)

  if [ -n "$matches" ]; then
    VIOLATIONS=$((VIOLATIONS + 1))
    echo "❌  Raw $pattern — use $replacement:"
    echo "$matches"
    echo ""
  fi
}

check '<button'   'Button from @shipshitdev/ui'
check '<input'    'Input from @shipshitdev/ui'
check '<textarea' 'Textarea from @shipshitdev/ui'
check '<select'   'Select from @shipshitdev/ui'
check '<dialog'   'Dialog from @shipshitdev/ui'
check '<hr'       'Separator (or remove)'

if [ "$VIOLATIONS" -gt 0 ]; then
  echo "Found $VIOLATIONS category(ies) of raw HTML element violations."
  exit 1
fi

echo "✅  No raw HTML element violations found."
