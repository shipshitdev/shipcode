#!/usr/bin/env bash
# Generate macOS ICNS and Linux PNG from icon.svg
# Requires: rsvg-convert (brew install librsvg) OR qlmanage/sips fallback
# Run from: apps/desktop/resources/

set -e
cd "$(dirname "$0")"

SVG="icon.svg"
ICONSET="icon.iconset"

echo "→ Generating PNG sizes from SVG..."

# Try rsvg-convert first (best quality), fall back to qlmanage
convert_svg() {
  local size=$1 out=$2
  if command -v rsvg-convert &>/dev/null; then
    rsvg-convert -w "$size" -h "$size" "$SVG" -o "$out"
  elif command -v convert &>/dev/null; then
    # ImageMagick
    convert -background none -resize "${size}x${size}" "$SVG" "$out"
  else
    echo "ERROR: Install librsvg (brew install librsvg) or ImageMagick"
    exit 1
  fi
}

mkdir -p "$ICONSET"

# macOS iconset sizes
convert_svg 16    "$ICONSET/icon_16x16.png"
convert_svg 32    "$ICONSET/icon_16x16@2x.png"
convert_svg 32    "$ICONSET/icon_32x32.png"
convert_svg 64    "$ICONSET/icon_32x32@2x.png"
convert_svg 128   "$ICONSET/icon_128x128.png"
convert_svg 256   "$ICONSET/icon_128x128@2x.png"
convert_svg 256   "$ICONSET/icon_256x256.png"
convert_svg 512   "$ICONSET/icon_256x256@2x.png"
convert_svg 512   "$ICONSET/icon_512x512.png"
convert_svg 1024  "$ICONSET/icon_512x512@2x.png"

echo "→ Building icon.icns..."
iconutil -c icns "$ICONSET" -o icon.icns

echo "→ Generating icon.png (512x512 for Linux)..."
convert_svg 512 icon.png

echo "→ Cleaning up iconset directory..."
rm -rf "$ICONSET"

echo "✓ Done: icon.icns + icon.png created in $(pwd)"
echo ""
echo "  electron-builder will pick these up automatically from resources/"
