#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT_DIR/web_frontend"
DIST_DIR="$SRC_DIR/dist"
BUILD_TAG="${BUILD_TAG:-$(date +%Y%m%d%H%M%S)}"

if [[ ! -d "$SRC_DIR" ]]; then
  echo "ERROR: web_frontend directory not found." >&2
  exit 1
fi

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

rsync -a --delete --exclude "dist" "$SRC_DIR/" "$DIST_DIR/"

python3 - <<PY
from pathlib import Path
import re

dist = Path(r"$DIST_DIR")
tag = r"$BUILD_TAG"

js_relative_import_from = re.compile(r"(from\s+['\"])((?:\./|\../)[^'\"?]+\.js)(['\"])")
js_relative_import_call = re.compile(r"(import\s*\(\s*['\"])((?:\./|\../)[^'\"?]+\.js)(['\"]\s*\))")

for path in dist.rglob("*"):
    if not path.is_file():
        continue
    if path.suffix.lower() not in {".html", ".css", ".js"}:
        continue
    text = path.read_text(encoding="utf-8")
    changed = False
    if "__BUILD_TAG__" in text:
        text = text.replace("__BUILD_TAG__", tag)
        changed = True
    if path.suffix.lower() == ".js":
        next_text = js_relative_import_from.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={tag}{m.group(3)}", text)
        next_text = js_relative_import_call.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={tag}{m.group(3)}", next_text)
        if next_text != text:
            text = next_text
            changed = True
    if changed:
        path.write_text(text, encoding="utf-8")

print(f"Patched build tag: {tag}")
PY

echo "Frontend build ready: $DIST_DIR"
echo "Upload all files under: $DIST_DIR"
