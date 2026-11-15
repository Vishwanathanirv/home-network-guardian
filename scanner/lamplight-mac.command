#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Lamplight needs Node.js, which is free."
  echo "  1. Get it from https://nodejs.org  (the big green LTS button)"
  echo "  2. Install it, then double-click this file again."
  echo
  read -n 1 -s -r -p "  Press any key to close."
  exit 1
fi
echo
echo "  Starting Lamplight and opening your browser..."
echo "  Keep this window open while you use it. Close it to stop watching."
echo
node "$(dirname "$0")/lamplight.cjs" live
