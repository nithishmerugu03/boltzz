"""Environment-driven configuration. Secrets are only read from the environment."""
import os
from pathlib import Path


def _load_dotenv() -> None:
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()


def get(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def module_mode() -> str:
    mode = get("MODULE_MODE", "mock").lower()
    if mode not in ("mock", "real"):
        raise ValueError(f"MODULE_MODE must be 'mock' or 'real', got '{mode}'")
    return mode
