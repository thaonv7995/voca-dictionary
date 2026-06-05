#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Generate App Icon
swift generate_icon.swift
iconutil -c icns AppIcon.iconset -o AppIcon.icns

swift build --disable-sandbox -c release

APP_DIR=".build/release/VocaMenuBar.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"
cp ".build/release/VocaMenuBar" "$MACOS_DIR/VocaMenuBar"
cp "AppIcon.icns" "$RESOURCES_DIR/"

cat > "$CONTENTS_DIR/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>VocaMenuBar</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>local.voca.menubar</string>
  <key>CFBundleName</key>
  <string>VocaMenuBar</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
PLIST

# Create ZIP Release
RELEASE_ZIP="$PWD/VocaRelease.zip"
RELEASE_DMG="$PWD/VocaMenuBar.dmg"
DMG_STAGING="$PWD/.build/dmg_staging"

rm -rf "$DMG_STAGING"
mkdir -p "$DMG_STAGING"
cp -R "$APP_DIR" "$DMG_STAGING/"
ln -s /Applications "$DMG_STAGING/Applications"
rm -f "$RELEASE_DMG"
hdiutil create -volname "VocaMenuBar" -srcfolder "$DMG_STAGING" -ov -format UDZO "$RELEASE_DMG"

rm -f "$RELEASE_ZIP"
rm -rf ".build/release_package"
mkdir -p ".build/release_package"
cp -R "$APP_DIR" ".build/release_package/"
cp "$RELEASE_DMG" ".build/release_package/"
cd ".build/release_package"
zip -rq "$RELEASE_ZIP" "VocaMenuBar.app" "VocaMenuBar.dmg"
cd ../..

echo "Built: $PWD/$APP_DIR"
echo "DMG: $RELEASE_DMG"
echo "Release archive: $RELEASE_ZIP"
