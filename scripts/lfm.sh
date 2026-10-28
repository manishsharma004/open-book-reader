#!/usr/bin/env bash
# Serve LiquidAI LFM3-Audio-2B on port 7510 for the Open Book Reader.
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cache=$root/var/lfm
release=b11941
archive=llama-${release}-bin-ubuntu-vulkan-x64.tar.gz
model=LFM3-Audio-2B-Q4_K_M.gguf
projector=mmproj-LFM3-Audio-2B-Q8_0.gguf
repo=https://huggingface.co/LiquidAI/LFM3-Audio-2B-GGUF/resolve/main
bind=${LFM_HOST:-127.0.0.1}
port=${LFM_PORT:-7510}

usage() {
  cat <<'EOF'
Usage: scripts/lfm.sh

Download llama.cpp b11941 (Vulkan) and LiquidAI/LFM3-Audio-2B-GGUF, then
listen on port 7510. Settings → TTS → LFM3 Audio uses that address.

The weights are Q4_K_M (about 1.10 GB) plus the Q8 audio projector (about
338 MB). On this machine the RX 5500M (Navi 14, PCI 1002:7340) reports
4080 MB of VRAM and about 3333 MB free with the desktop up, so that pair
fits when the context is 2048 tokens. The ROCm llama.cpp build does not
target gfx1012, so this script uses Vulkan and asks Mesa for that PCI id.
Voices are female and male. The model does not clone a sample.

The files stay in var/lfm and are not committed.

Environment:
  LFM_HOST   bind address (default 127.0.0.1)
  LFM_PORT   port (default 7510)

Stop the server with Ctrl-C. The app server keeps running.
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi
if [ $# -gt 0 ]; then
  echo "scripts/lfm.sh: unknown argument: $1" >&2
  usage >&2
  exit 2
fi

mkdir -p "$cache"
if [ ! -s "$cache/$archive" ]; then
  curl -fL --retry 3 -o "$cache/$archive" \
    "https://github.com/ggml-org/llama.cpp/releases/download/${release}/${archive}"
fi
if [ ! -x "$cache/llama-${release}/llama-server" ]; then
  tar -xzf "$cache/$archive" -C "$cache"
fi
big_enough() {
  [ -f "$1" ] && [ "$(stat -c%s "$1")" -ge "$2" ]
}
if ! big_enough "$cache/$model" 1000000000; then
  curl -fL --retry 3 -C - -o "$cache/$model" "$repo/$model"
fi
if ! big_enough "$cache/$projector" 300000000; then
  curl -fL --retry 3 -C - -o "$cache/$projector" "$repo/$projector"
fi

export MESA_VK_DEVICE_SELECT="${MESA_VK_DEVICE_SELECT:-1002:7340!}"
server=$cache/llama-${release}/llama-server
echo "Vulkan devices:"
"$server" --list-devices || true

exec "$server" \
  --host "$bind" \
  --port "$port" \
  -m "$cache/$model" \
  -mm "$cache/$projector" \
  -ngl 99 \
  -c 2048 \
  --fit on \
  --fit-target 512 \
  -dev Vulkan0
