#!/bin/sh
# Install the PyTorch wheel for TORCH_BACKEND, then Pocket, then put that wheel back.
# pocket-tts depends on torch and would otherwise take the default PyPI build.
set -eu

backend="${TORCH_BACKEND:-cpu}"
case "$backend" in
  cpu)
    index="https://download.pytorch.org/whl/cpu"
    spec="torch"
    ;;
  cuda)
    index="https://download.pytorch.org/whl/cu128"
    spec="torch"
    ;;
  rocm)
    index="https://stable.repo.amd.com/rocm/whl-next/"
    spec="torch[device-all]==2.14.0+rocm10.1.0"
    ;;
  *)
    echo "TORCH_BACKEND must be cpu, cuda, or rocm" >&2
    exit 1
    ;;
esac

pip install --no-cache-dir --index-url "$index" --extra-index-url https://pypi.org/simple "$spec"
version=$(python -c "import torch; print(torch.__version__)")
pip install --no-cache-dir -r /tmp/pocket-requirements.txt
if [ "$backend" = "rocm" ]; then
  spec="torch[device-all]==${version}"
else
  spec="torch==${version}"
fi
pip install --no-cache-dir --force-reinstall --index-url "$index" --extra-index-url https://pypi.org/simple "$spec"
python -c "import torch; print('torch', torch.__version__, 'hip', getattr(torch.version, 'hip', None))"
