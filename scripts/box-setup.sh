#!/usr/bin/env bash
# Prepares a Boat machine for `box`, which runs it whenever it changes: the Bun that package.json
# pins, since the stock image's older one can't read bun.lock; Playwright's Chromium for the
# preview and verify captures; and the Mac's Blender, with the Pillow and NumPy that the asset
# generators' texture step runs under python3. Mesa's llvmpipe, which tools/chromium.ts selects
# for every capture and spec, renders the game ten times faster than Chromium's SwiftShader.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

version="$(sed -n 's/.*"packageManager": "bun@\([^"]*\)".*/\1/p' package.json)"
if [[ "$(bun --version 2>/dev/null)" != "$version" ]]; then
  curl -fsSL https://bun.sh/install | bash -s "bun-v$version"
  sudo ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun
  sudo ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bunx
fi

# Boat's snapshots drop ~/.cache, where Playwright keeps its browsers.
export PLAYWRIGHT_BROWSERS_PATH="$HOME/.playwright"
grep -q PLAYWRIGHT_BROWSERS_PATH /etc/environment ||
  echo "PLAYWRIGHT_BROWSERS_PATH=$PLAYWRIGHT_BROWSERS_PATH" | sudo tee -a /etc/environment >/dev/null
bun install --frozen-lockfile
bunx --no-install playwright install --with-deps chromium

blender_version=5.2.0
blender_sha256=96f6c181a30f4950607839dc84d42a354b250d8a0231b098b59b7bc69c351c48
if [[ "$(blender --version 2>/dev/null | head -1)" != "Blender $blender_version"* ]]; then
  archive="/tmp/blender-$blender_version.tar.xz"
  curl -fsSL -o "$archive" "https://download.blender.org/release/Blender${blender_version%.*}/blender-$blender_version-linux-x64.tar.xz"
  echo "$blender_sha256  $archive" | sha256sum -c --quiet
  sudo rm -rf /opt/blender && sudo mkdir -p /opt/blender
  sudo tar -xJf "$archive" -C /opt/blender --strip-components 1
  rm "$archive"
  sudo ln -sf /opt/blender/blender /usr/local/bin/blender
fi
sudo apt-get install -y -qq libxi6 libxkbcommon0 libsm6 libgl1 libxrender1 libxxf86vm1 libxfixes3 \
  libgl1-mesa-dri libegl1 python3-pil python3-numpy >/dev/null
