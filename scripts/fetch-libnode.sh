#!/usr/bin/env bash
# Baixa o Node.js para Android (nodejs-mobile) usado pelo APK.
set -euo pipefail
V="v18.20.4"
DEST="android/app/libnode"
if [ -f "$DEST/bin/arm64-v8a/libnode.so" ]; then echo "libnode já presente"; exit 0; fi
mkdir -p "$DEST"
TMP="$(mktemp -d)"
curl -fL --retry 3 -o "$TMP/node.zip" "https://github.com/nodejs-mobile/nodejs-mobile/releases/download/$V/nodejs-mobile-$V-android.zip"
unzip -q "$TMP/node.zip" -d "$TMP/x"
cp -r "$TMP/x/"* "$DEST/"
rm -rf "$TMP"
echo "libnode $V instalado em $DEST"
