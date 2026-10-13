#!/bin/bash
set -euo pipefail

APP_NAME="VoxPaperAi Pro"
DMG_NAME="VoxPaperAi_Pro_Installer.dmg"
DIST_DIR="dist_release"
BUILD_DIR="build_release"
DMG_STAGING="dmg_staging_release"
ICON_PNG="src/ui/assets/logo.png"
ICON_ICNS="resources/icon.icns"
GUIDE_FILE="INSTALL_FREE_MACOS.txt"
DISCLAIMER_FILE="DISCLAIMER.txt"

echo "🧹 Cleaning previous release artifacts..."
rm -rf "$DIST_DIR" "$BUILD_DIR" "$DMG_STAGING"
mkdir -p resources

if [ ! -f "$ICON_PNG" ]; then
  echo "❌ Icon source not found: $ICON_PNG"
  exit 1
fi

if ! command -v sips >/dev/null 2>&1 || ! command -v iconutil >/dev/null 2>&1; then
  echo "❌ macOS tools 'sips' and 'iconutil' are required."
  exit 1
fi

echo "🎨 Generating .icns from logo..."
./.venv/bin/python - <<'PY'
from PIL import Image
src = Image.open("src/ui/assets/logo.png")
src.save("resources/icon.icns", format="ICNS", sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)])
print("ICNS generated via Pillow")
PY

echo "📦 Building app with PyInstaller..."
unset QT_PLUGIN_PATH
unset QT_QPA_PLATFORM_PLUGIN_PATH
unset DYLD_LIBRARY_PATH
unset DYLD_FRAMEWORK_PATH
unset DYLD_FALLBACK_LIBRARY_PATH
unset DYLD_FALLBACK_FRAMEWORK_PATH

echo "🔎 Preflight: verifying PyQt6 package is present in the build environment..."
./.venv/bin/python - <<'PY'
import importlib.metadata as metadata
from pathlib import Path

version = metadata.version("PyQt6")
dist = metadata.distribution("PyQt6")
base = Path(dist.locate_file("PyQt6"))
print(f"PyQt6 version: {version}")
print(f"PyQt6 package dir: {base}")
PY

export PYINSTALLER_CONFIG_DIR="$(pwd)/.pyinstaller"
export PYINSTALLER_CACHE_DIR="$(pwd)/.pyinstaller/cache"
./.venv/bin/python -m PyInstaller --noconfirm --clean \
  --distpath "$DIST_DIR" \
  --workpath "$BUILD_DIR" \
  "VoxPaperAi_Pro.spec"

APP_BUNDLE="$DIST_DIR/$APP_NAME.app"
if [ ! -d "$APP_BUNDLE" ]; then
  echo "❌ App bundle was not created."
  exit 1
fi

ENTITLEMENTS="resources/entitlements.plist"
if [ ! -f "$ENTITLEMENTS" ]; then
  echo "❌ Entitlements file not found: $ENTITLEMENTS"
  exit 1
fi

echo "🛡️ Signing app for distribution (ad-hoc + hardened runtime)..."

# Step 1: Remove all quarantine and extended attributes first
xattr -cr "$APP_BUNDLE"

# Step 2: Sign all individual .dylib and .so files
# Must be done BEFORE signing the bundle — codesign --deep sometimes misses order
echo "  → Signing dylibs and .so files..."
find "$APP_BUNDLE" \( -name "*.dylib" -o -name "*.so" \) | while read -r lib; do
  codesign --force --sign - --options runtime --entitlements "$ENTITLEMENTS" "$lib" 2>/dev/null || true
done

# Step 3: Sign nested .framework bundles individually
echo "  → Signing nested frameworks..."
find "$APP_BUNDLE/Contents/Frameworks" -maxdepth 1 -name "*.framework" | while read -r fw; do
  codesign --force --deep --sign - --options runtime --entitlements "$ENTITLEMENTS" "$fw" 2>/dev/null || true
done

# Step 4: Sign the main executable
echo "  → Signing main executable..."
codesign --force --sign - --options runtime --entitlements "$ENTITLEMENTS" \
  "$APP_BUNDLE/Contents/MacOS/$APP_NAME"

# Step 5: Sign the entire app bundle (must be last)
echo "  → Signing app bundle..."
codesign --force --deep --sign - --options runtime --entitlements "$ENTITLEMENTS" "$APP_BUNDLE"

# Step 6: Verify the signature is valid
echo "  → Verifying signature..."
codesign --verify --deep --strict "$APP_BUNDLE" && echo "  ✅ Signature OK" || { echo "  ❌ Signature verification failed!"; exit 1; }

echo "💿 Preparing DMG..."
mkdir -p "$DMG_STAGING"
cp -R "$APP_BUNDLE" "$DMG_STAGING/"
if [ -f "$GUIDE_FILE" ]; then
  cp "$GUIDE_FILE" "$DMG_STAGING/"
fi
if [ -f "$DISCLAIMER_FILE" ]; then
  cp "$DISCLAIMER_FILE" "$DMG_STAGING/"
fi
ln -s /Applications "$DMG_STAGING/Applications"
rm -f "$DMG_NAME"
hdiutil create -volname "VoxPaperAi Pro" -srcfolder "$DMG_STAGING" -ov -format UDZO "$DMG_NAME"
rm -rf "$DMG_STAGING"

# Step 7: Remove quarantine from final DMG so it doesn't propagate to users
xattr -d com.apple.quarantine "$DMG_NAME" 2>/dev/null || true

echo ""
echo "✅ Release artifacts ready:"
echo "  App: $APP_BUNDLE"
echo "  DMG: $(pwd)/$DMG_NAME"
