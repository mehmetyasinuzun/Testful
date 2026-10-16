#!/usr/bin/env bash
# Testful CI: hedef projenin türünü algılar → GITHUB_OUTPUT: kind, has_scenarios.
set -euo pipefail

out() { echo "$1=$2" >> "${GITHUB_OUTPUT:-/dev/null}"; echo "$1=$2"; }

if [ -n "${APK_PATH:-}" ]; then kind=apk
elif [ -n "${BUILD_COMMAND:-}" ]; then kind=custom
elif [ -f pubspec.yaml ]; then kind=flutter
elif [ -f package.json ] && grep -q '"expo"' package.json && [ ! -d android ]; then kind=expo
elif [ -f package.json ] && grep -q '"react-native"' package.json; then kind=react-native
elif [ -f gradlew ]; then kind=gradle
elif [ -f android/gradlew ]; then kind=android-subdir
else kind=unknown
fi
out kind "$kind"

if compgen -G ".qa/scenarios/*.flow.yaml" > /dev/null; then
  out has_scenarios true
else
  out has_scenarios false
fi
