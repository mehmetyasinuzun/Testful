#!/usr/bin/env bash
# Testful günlük log sistemi: her satır hem ekrana hem .qa/logs/YYYY-MM-DD.log
# dosyasına (zaman damgalı) yazılır. Konum TESTFUL_LOG_DIR ile değiştirilebilir.
TESTFUL_LOG_DIR="${TESTFUL_LOG_DIR:-.qa/logs}"
qa_log() {
  local line="$*"
  echo "$line"
  mkdir -p "$TESTFUL_LOG_DIR" 2>/dev/null && \
    printf '%s %s\n' "$(date '+%FT%T')" "$line" >> "$TESTFUL_LOG_DIR/$(date +%F).log"
}
