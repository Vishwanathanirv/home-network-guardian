#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Lamplight needs Node.js, which is free: https://nodejs.org"
  echo "Install it, then double-click this file again."
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi
if [ ! -f lamplight.cjs ]; then
  echo "First run: downloading the scanner..."
  curl -fsSL -o lamplight.cjs https://raw.githubusercontent.com/Vishwanathanirv/home-network-guardian/main/scanner/lamplight.cjs || { echo "Could not download the scanner. Check your internet and run this again."; read -n 1 -s -r; exit 1; }
fi
echo "Starting Lamplight and opening your browser..."
node lamplight.cjs live
