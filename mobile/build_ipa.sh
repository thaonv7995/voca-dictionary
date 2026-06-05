#!/bin/bash
set -e

echo "=== 1. Cleaning old build directories ==="
rm -rf build_output VocaMobile.ipa Payload

echo "=== 2. Building VocaMobile.app via xcodebuild (Unsigned Release) ==="
cd ios
xcodebuild -workspace VocaMobile.xcworkspace \
           -scheme VocaMobile \
           -configuration Release \
           -sdk iphoneos \
           -derivedDataPath ../build_output \
           CODE_SIGNING_ALLOWED=NO \
           CODE_SIGNING_REQUIRED=NO \
           CODE_SIGN_IDENTITY="" \
           PROVISIONING_PROFILE_SPECIFIER=""

echo "=== 3. Packaging into VocaMobile.ipa ==="
cd ..
mkdir -p Payload
cp -r build_output/Build/Products/Release-iphoneos/VocaMobile.app Payload/
zip -r VocaMobile.ipa Payload

echo "=== 4. Cleaning temporary files ==="
rm -rf Payload build_output

echo "=== Build Succeeded! VocaMobile.ipa is ready ==="
ls -l VocaMobile.ipa
