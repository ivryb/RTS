#!/usr/bin/env bash
# Prepares a Boat machine for `box`, which runs it whenever it changes: the Bun that package.json
# pins, since the stock image's older one can't read bun.lock, and Playwright's Chromium for the
# preview and verify captures.
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
