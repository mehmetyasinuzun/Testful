#!/usr/bin/env bash
# Testful CI: proje türünü algılar, APK'yı derler, yolunu GITHUB_OUTPUT'a yazar.
# Çalışma dizini = hedef projenin kökü (action'ın working-directory girdisi).
#
# env: APK_PATH (hazır APK — derleme atlanır) · BUILD_COMMAND (özel derleme)
#      PROJECT_KIND (detect adımından: flutter|react-native|expo|gradle|android-subdir|apk)
set -euo pipefail

out() { echo "$1=$2" >> "${GITHUB_OUTPUT:-/dev/null}"; echo "$1=$2"; }

newest_apk() {
  # Test APK'larını ve hizalanmamış ara çıktıları dışla; en yenisini seç.
  find "$@" -type f -name '*.apk' \
    ! -path '*androidTest*' ! -name '*-unaligned.apk' ! -name '*-unsigned.apk' \
    -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-
}

if [ -n "${APK_PATH:-}" ]; then
  [ -f "$APK_PATH" ] || { echo "::error::apk-path bulunamadı: $APK_PATH"; exit 1; }
  out apk "$(realpath "$APK_PATH")"
  exit 0
fi

install_js_deps() {
  if [ -f pnpm-lock.yaml ]; then npx --yes pnpm install --frozen-lockfile
  elif [ -f yarn.lock ]; then npx --yes yarn install --frozen-lockfile
  elif [ -f package-lock.json ]; then npm ci
  else npm install
  fi
}

kind="${PROJECT_KIND:-}"
if [ -n "${BUILD_COMMAND:-}" ]; then
  echo "[testful] özel derleme komutu: $BUILD_COMMAND"
  bash -c "$BUILD_COMMAND"
  apk="$(newest_apk .)"
else
  case "$kind" in
    flutter)
      flutter pub get
      flutter build apk --debug
      apk="$(newest_apk build/app/outputs/flutter-apk build/app/outputs)"
      ;;
    react-native|expo)
      install_js_deps
      if [ ! -d android ]; then
        npx --yes expo prebuild --platform android --no-install
      fi
      # RN debug APK Metro sunucusu ister; CI'da JS gömülü release (debug imzalı) derlenir.
      (cd android && chmod +x gradlew && ./gradlew assembleRelease --no-daemon)
      apk="$(newest_apk android/app/build/outputs/apk/release android/app/build/outputs/apk)"
      ;;
    gradle)
      chmod +x gradlew && ./gradlew assembleDebug --no-daemon
      apk="$(newest_apk . )"
      ;;
    android-subdir)
      (cd android && chmod +x gradlew && ./gradlew assembleDebug --no-daemon)
      apk="$(newest_apk android)"
      ;;
    *)
      echo "::error::Proje türü algılanamadı. 'apk-path' ya da 'build-command' girdisini ver."
      exit 1
      ;;
  esac
fi

[ -n "${apk:-}" ] && [ -f "$apk" ] || { echo "::error::Derleme bitti ama APK bulunamadı."; exit 1; }
out apk "$(realpath "$apk")"
