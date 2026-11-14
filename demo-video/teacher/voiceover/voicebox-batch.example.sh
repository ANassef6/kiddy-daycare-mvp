#!/usr/bin/env bash
# Local Voicebox batch runner template for the teacher demo.
#
# This script does NOT clone or store a voice. It reads the line list and calls
# the local Voicebox command that the board configures.
#
# Required environment:
#   VOICEBOX_CMD  command that reads LINE_TEXT_FILE and writes OUT_FILE
#   VOICE_ID      the board's own cloned voice id inside Voicebox (optional if
#                 the command already selects the voice)
#
# Usage (from demo-video/teacher):
#   VOICE_ID=... VOICEBOX_CMD='...' bash voiceover/voicebox-batch.example.sh en
#   VOICE_ID=... VOICEBOX_CMD='...' bash voiceover/voicebox-batch.example.sh ar
set -euo pipefail

LANG_KEY="${1:-en}"
if [[ "$LANG_KEY" != "en" && "$LANG_KEY" != "ar" ]]; then
  echo "Usage: $0 [en|ar]" >&2
  exit 2
fi

BATCH="voiceover/voicebox-batch.${LANG_KEY}.json"
OUT_DIR="voiceover/wav/${LANG_KEY}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if [[ -z "${VOICEBOX_CMD:-}" ]]; then
  echo "Set VOICEBOX_CMD to your local Voicebox invocation." >&2
  exit 2
fi

mkdir -p "$OUT_DIR"
export VOICE_ID="${VOICE_ID:-}"

node -e '
  const fs = require("fs");
  const batch = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  for (const line of batch.lines) {
    console.log(JSON.stringify({ id: line.id, text: line.text, language: line.language, out: line.out }));
  }
' "$BATCH" |
while IFS= read -r row; do
  id="$(node -e 'console.log(JSON.parse(process.argv[1]).id)' "$row")"
  text="$(node -e 'console.log(JSON.parse(process.argv[1]).text)' "$row")"
  language="$(node -e 'console.log(JSON.parse(process.argv[1]).language)' "$row")"
  out="$(node -e 'console.log(JSON.parse(process.argv[1]).out)' "$row")"

  LINE_TEXT_FILE="$TMP_DIR/${id}.txt"
  OUT_FILE="$out"
  mkdir -p "$(dirname "$OUT_FILE")"
  printf '%s\n' "$text" > "$LINE_TEXT_FILE"

  echo "Synthesizing ${id} (${language})"
  export LINE_ID="$id" LINE_TEXT_FILE OUT_FILE LANGUAGE="$language"
  bash -c "$VOICEBOX_CMD"
done

echo "Done. WAVs are in ${OUT_DIR}/"
