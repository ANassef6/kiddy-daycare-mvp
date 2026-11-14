#!/usr/bin/env python3
"""Generate the scene voiceover WAVs with Microsoft Edge neural TTS.

Writes voiceover/wav/<lang>/<scene-id>.wav (24 kHz, 16-bit, mono) for every
line in voiceover/voicebox-batch.<lang>.json, so assembly can run without a
human recording session. Existing files are never overwritten unless --force
is passed, so a human Voicebox recording can safely replace single scenes.

Requires: python3, the `edge-tts` package (pip install edge-tts), and ffmpeg
(ffmpeg-static from demo-video/teacher/node_modules, or a system install).
Requires network access to the Edge Read Aloud endpoint. No API key needed.

Usage (from demo-video/teacher):
  python3 capture/gen-wavs.py --lang en
  python3 capture/gen-wavs.py --lang ar
  python3 capture/gen-wavs.py --lang en --only 01-login,02-dashboard
  python3 capture/gen-wavs.py --lang en --force --rate +5%
"""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

DEFAULT_VOICES = {
    "en": "en-US-AndrewMultilingualNeural",
    "ar": "ar-EG-SalmaNeural",
}


def resolve_ffmpeg() -> str:
    candidates = []
    env = shutil.which("ffmpeg")
    if env:
        candidates.append(env)
    try:
        out = subprocess.run(
            ["node", "-e", "console.log(require('ffmpeg-static'))"],
            cwd=ROOT, capture_output=True, text=True, timeout=30,
        )
        if out.returncode == 0 and out.stdout.strip():
            candidates.append(out.stdout.strip())
    except Exception:
        pass
    for c in candidates:
        if Path(c).exists():
            return c
    raise SystemExit("ffmpeg not found. Run: npm run setup  (or install ffmpeg)")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lang", choices=["en", "ar"], default="en")
    parser.add_argument("--only", default="", help="comma-separated scene ids")
    parser.add_argument("--voice", default="", help="override neural voice name")
    parser.add_argument("--rate", default="+0%", help="e.g. +10% or -5%")
    parser.add_argument("--force", action="store_true", help="overwrite existing WAVs")
    args = parser.parse_args()

    try:
        import edge_tts
    except ImportError:
        print("edge-tts is not installed. Run: python3 -m pip install --break-system-packages edge-tts", file=sys.stderr)
        return 2

    batch_path = ROOT / "voiceover" / f"voicebox-batch.{args.lang}.json"
    batch = json.loads(batch_path.read_text(encoding="utf-8"))
    wav_dir = ROOT / "voiceover" / "wav" / args.lang
    wav_dir.mkdir(parents=True, exist_ok=True)

    voice = args.voice or DEFAULT_VOICES[args.lang]
    only = [s.strip() for s in args.only.split(",") if s.strip()]
    lines = [l for l in batch["lines"] if not only or l["id"] in only]
    if not lines:
        print(f"No lines matched --only {only}", file=sys.stderr)
        return 2

    ffmpeg = resolve_ffmpeg()
    generated, skipped, failed = [], [], []

    for line in lines:
        out_path = ROOT / line["out"]
        if out_path.exists() and not args.force:
            skipped.append(line["id"])
            continue
        out_path.parent.mkdir(parents=True, exist_ok=True)
        print(f"Synthesizing {line['id']} ({voice}) ... ", end="", flush=True)
        try:
            with tempfile.TemporaryDirectory() as tmp:
                mp3 = Path(tmp) / "audio.mp3"
                last_err = None
                for attempt in range(3):
                    try:
                        async_cm = edge_tts.Communicate(line["text"], voice, rate=args.rate)
                        asyncio_run(async_cm, mp3)
                        last_err = None
                        break
                    except Exception as err:  # noqa: BLE001
                        last_err = err
                if last_err is not None:
                    raise last_err
                subprocess.run(
                    [ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                     "-i", str(mp3), "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le",
                     str(out_path)],
                    check=True, capture_output=True,
                )
            probe = subprocess.run(
                [ffmpeg, "-hide_banner", "-i", str(out_path)],
                capture_output=True, text=True,
            )
            import re
            m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", probe.stderr)
            secs = float(m.group(1)) * 3600 + float(m.group(2)) * 60 + float(m.group(3)) if m else 0.0
            target = line.get("targetDurationSec")
            tag = f" ({secs:.1f}s vs target {target}s)" if target else f" ({secs:.1f}s)"
            print(f"done{tag}")
            generated.append(line["id"])
        except Exception as err:  # noqa: BLE001
            print("FAILED")
            print(f"  {line['id']}: {err}", file=sys.stderr)
            failed.append(line["id"])

    print(f"\nDone. {len(generated)} generated, {len(skipped)} already present, "
          f"{len(failed)} failed. WAVs in {wav_dir}")
    if failed:
        print(f"Failed ids: {', '.join(failed)}", file=sys.stderr)
        return 1
    return 0


def asyncio_run(cm, mp3: Path) -> None:
    import asyncio

    async def run():
        with open(mp3, "wb") as f:
            async for chunk in cm.stream():
                if chunk["type"] == "audio":
                    f.write(chunk["data"])

    asyncio.run(run())


if __name__ == "__main__":
    sys.exit(main())
