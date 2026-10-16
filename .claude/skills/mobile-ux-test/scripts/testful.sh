#!/usr/bin/env bash
if command -v testful >/dev/null 2>&1; then exec testful "$@"; fi
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for cand in "$TESTFUL_HOME/cli/testful.mjs" "$here/../../../../cli/testful.mjs"; do
  if [ -f "$cand" ]; then exec node "$cand" "$@"; fi
done
echo "testful bulunamadı: 'npm i -g github:mehmetyasinuzun/Testful' ya da TESTFUL_HOME=<repo yolu> ayarla" >&2
exit 3
