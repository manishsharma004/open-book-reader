#!/usr/bin/env bash
# Build and start Open Book Reader: the app server, Kokoro, and Pocket TTS.
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
backend=""

usage() {
  cat <<'EOF'
Usage: scripts/run.sh --torch-backend cpu|cuda|rocm

Build the images and start the whole app. The browser opens the app server.
Kokoro and Pocket stay behind it.

  --torch-backend cpu|cuda|rocm
      PyTorch wheel baked into the Pocket image.
      cpu    CPU wheel from https://download.pytorch.org/whl/cpu.
             No GPU is passed into the container.
      cuda   CUDA 12.8 wheel from https://download.pytorch.org/whl/cu128.
             Every NVIDIA GPU is reserved. The host needs a current NVIDIA
             driver and the NVIDIA Container Toolkit (nvidia-smi must work).
      rocm   AMD ROCm wheel torch[device-all]==2.14.0+rocm10.1.0 from
             https://stable.repo.amd.com/rocm/whl-next/. That wheel includes
             gfx1012, which is the RX 5500M. The container receives /dev/kfd
             and /dev/dri, host IPC, SYS_PTRACE, and an unconfined seccomp
             profile. Pocket runs as root in the image so it can open those
             device nodes. Do not set HSA_OVERRIDE_GFX_VERSION.

Pocket uses the GPU only when that card is visible and at least 1 GB is free.
Otherwise it stays on the CPU. Kokoro is the CPU image
ghcr.io/remsky/kokoro-fastapi-cpu:v0.9.0 and is not given the GPU, so the card
stays available for Pocket and for a text model. A text model is not bundled.
Point a text profile at Ollama on the host with
http://host.docker.internal:11434/v1 and set OLLAMA_ALLOW for that host if
the built-in addresses do not match.

Ports, on the host:
  7507   the app. Open http://localhost:7507
  7508   Pocket TTS, published so a phone can store http://<this-lan-ip>:7508
  7510   LFM3 Audio, only when scripts/lfm.sh is running
  8880   Kokoro, only inside the Compose network as http://kokoro:8880

The browser still calls only the app. Settings can keep
http://127.0.0.1:7508 for Pocket and http://127.0.0.1:8880/v1 for Kokoro.
The app server rewrites those approved addresses to the Compose services.
A caller cannot choose a different upstream.

Pocket weights are gated. Accept the terms at
https://huggingface.co/kyutai/pocket-tts and export HF_TOKEN before running
this script. The token is passed into the Pocket container and is not written
into the image. Without it, builtin voices cannot download those weights.
On-device Pocket in the browser does not use this token.

Examples:
  scripts/run.sh --torch-backend cpu
  HF_TOKEN=hf_... scripts/run.sh --torch-backend rocm
  scripts/run.sh --torch-backend cuda

Stop the stack from the repository root, with the same backend you started:
  docker compose --profile cpu down
  docker compose --profile cuda down
  docker compose --profile rocm down

Docker Compose v2 is required (`docker compose`, not `docker-compose`).
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --torch-backend)
      if [ $# -lt 2 ]; then
        echo "scripts/run.sh: --torch-backend needs cpu, cuda, or rocm" >&2
        usage >&2
        exit 2
      fi
      backend=$2
      shift 2
      ;;
    --torch-backend=*)
      backend=${1#--torch-backend=}
      shift
      ;;
    *)
      echo "scripts/run.sh: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$backend" ]; then
  echo "scripts/run.sh: --torch-backend is required" >&2
  usage >&2
  exit 2
fi

case "$backend" in
  cpu|cuda|rocm) ;;
  *)
    echo "scripts/run.sh: torch backend must be cpu, cuda, or rocm" >&2
    exit 2
    ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  echo "scripts/run.sh: docker is not installed" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "scripts/run.sh: docker compose v2 is not available" >&2
  exit 1
fi

export TORCH_BACKEND="$backend"
export POCKET_LANGUAGE="${POCKET_LANGUAGE:-english_18m_refl_2026-10}"
if [ -n "${HF_TOKEN:-}" ]; then
  export HF_TOKEN
else
  echo "scripts/run.sh: HF_TOKEN is unset. Pocket can start, and gated weights will not download." >&2
fi

if [ "$backend" = "cuda" ]; then
  if ! command -v nvidia-smi >/dev/null 2>&1 || ! nvidia-smi -L >/dev/null 2>&1; then
    echo "scripts/run.sh: cuda needs a working NVIDIA driver (nvidia-smi) and the NVIDIA Container Toolkit" >&2
    exit 1
  fi
fi

if [ "$backend" = "rocm" ]; then
  if [ ! -e /dev/kfd ] || [ ! -d /dev/dri ]; then
    echo "scripts/run.sh: rocm needs /dev/kfd and /dev/dri from the host AMD driver" >&2
    exit 1
  fi
fi

cd "$root"
exec docker compose --profile "$backend" up --build
