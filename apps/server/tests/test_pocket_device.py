"""Pocket device choice does not import torch."""

import importlib.util
import os
from pathlib import Path

_PATH = Path(__file__).resolve().parents[3] / "services" / "pocket" / "app.py"
_SPEC = importlib.util.spec_from_file_location("pocket_app", _PATH)
assert _SPEC is not None and _SPEC.loader is not None
pocket_app = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(pocket_app)


def test_gpu_needs_a_visible_card_and_a_gigabyte_free():
    choose = pocket_app.choose_torch_device
    floor = pocket_app.GPU_FREE_BYTES
    assert choose(False, floor) == "cpu"
    assert choose(True, None) == "cpu"
    assert choose(True, floor - 1) == "cpu"
    assert choose(True, floor) == "cuda"
    assert choose(True, floor + 1) == "cuda"


def test_pocket_device_env_wins_without_loading_torch(monkeypatch):
    monkeypatch.setenv("POCKET_DEVICE", "cpu")
    assert pocket_app.torch_device() == "cpu"


def test_blank_hf_token_is_removed(monkeypatch):
    monkeypatch.setenv("HF_TOKEN", "")
    monkeypatch.setenv("HUGGING_FACE_HUB_TOKEN", "")
    pocket_app.drop_blank_tokens()
    assert "HF_TOKEN" not in os.environ
    assert "HUGGING_FACE_HUB_TOKEN" not in os.environ


def test_real_hf_token_stays(monkeypatch):
    monkeypatch.setenv("HF_TOKEN", "hf_example")
    pocket_app.drop_blank_tokens()
    assert os.environ["HF_TOKEN"] == "hf_example"
