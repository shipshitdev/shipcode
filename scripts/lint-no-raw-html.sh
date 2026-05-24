#!/usr/bin/env bash
# Enforce @shipcode/ui primitives — block raw HTML elements in production .tsx files.
# Runs as a pre-commit hook. Receives file paths as arguments.
#
# Excluded paths (legitimate wrappers):
#   - packages/ui/src/       — the primitive wrappers themselves
#   - .test. .spec. .stories. — test and story files

set -euo pipefail

# ─── Raw HTML → @shipcode/ui mapping ──────────────────────────────────
# Each entry: "pattern|replacement"
RULES=(
  '<input\b|Input from @shipcode/ui'
  '<button\b|Button from @shipcode/ui'
  '<textarea\b|Textarea from @shipcode/ui'
  '<select\b|Select from @shipcode/ui'
  '<dialog\b|Dialog from @shipcode/ui'
  '<table\b|Table from @shipcode/ui'
  '<details\b|Collapsible from @shipcode/ui'
  '<summary\b|CollapsibleTrigger from @shipcode/ui'
  '<progress\b|Progress from @shipcode/ui'
  '<hr\b|Separator from @shipcode/ui'
)

# Build combined grep pattern from all rules
PATTERN=""
for rule in "${RULES[@]}"; do
  element_pattern="${rule%%|*}"
  if [ -z "$PATTERN" ]; then
    PATTERN="$element_pattern"
  else
    PATTERN="$PATTERN|$element_pattern"
  fi
done

violations=0
violated_files=()

mark_violation() {
  local file="$1"

  for violated_file in "${violated_files[@]}"; do
    [[ "$violated_file" == "$file" ]] && return
  done

  violated_files+=("$file")
  violations=$((violations + 1))
}

for file in "$@"; do
  # Skip unsupported files
  [[ "$file" != *.tsx && "$file" != *.ts ]] && continue

  # Skip test, spec, story, and mock files
  [[ "$file" == *.test.* ]] && continue
  [[ "$file" == *.spec.* ]] && continue
  [[ "$file" == *.stories.* ]] && continue
  [[ "$file" == */__mocks__/* ]] && continue

  # Skip UI primitive wrappers
  [[ "$file" == packages/ui/src/* ]] && continue
  [[ "$file" == */packages/ui/src/* ]] && continue

  # Check for raw HTML elements in TSX only
  if [[ "$file" == *.tsx ]] && grep -qnE "$PATTERN" -- "$file" 2>/dev/null; then
    matches=$(grep -nE "$PATTERN" -- "$file" 2>/dev/null || true)
    # Filter out JSX comments {/* ... */}
    matches=$(echo "$matches" | grep -v '{/\*' | grep -v '\*/' || true)
    if [ -n "$matches" ]; then
      mark_violation "$file"
      echo ""
      echo "  ✘ $file"
      echo "$matches" | while IFS= read -r line; do
        echo "    $line"
      done
    fi
  fi
done

if [ "$violations" -gt 0 ]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ✘ Found raw HTML elements in $violations file(s)."
  echo ""
  echo "  Use @shipcode/ui components instead:"
  echo ""
  for rule in "${RULES[@]}"; do
    element_pattern="${rule%%|*}"
    replacement="${rule#*|}"
    display_tag=$(echo "$element_pattern" | sed 's/\\b/>/g' | sed 's/</</g')
    printf "    %-14s → %s\n" "$display_tag" "$replacement"
  done
  echo ""
  echo "  If this is a legitimate wrapper, add the path to the"
  echo "  exclusion list in scripts/lint-no-raw-html.sh"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi
