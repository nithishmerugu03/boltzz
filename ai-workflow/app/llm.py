"""Minimal Groq chat-completions client (OpenAI-compatible endpoint) returning parsed JSON."""
from __future__ import annotations

import json
import urllib.error
import urllib.request

from . import config

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


class LLMError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def groq_json_completion(system: str, user: str) -> dict:
    api_key = config.get("GROQ_API_KEY")
    if not api_key:
        raise LLMError("LLM_UNAVAILABLE", "GROQ_API_KEY is not configured")
    body = {
        "model": config.get("GROQ_MODEL", "llama-3.3-70b-versatile"),
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }
    req = urllib.request.Request(GROQ_URL, data=json.dumps(body).encode(), method="POST", headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        # Never include request headers (API key) in the error.
        raise LLMError("LLM_API_ERROR", f"Groq API returned HTTP {exc.code}") from None
    except (urllib.error.URLError, TimeoutError) as exc:
        raise LLMError("LLM_UNAVAILABLE", f"Groq API unreachable: {exc}") from None
    try:
        return json.loads(payload["choices"][0]["message"]["content"])
    except (KeyError, IndexError, TypeError, json.JSONDecodeError):
        raise LLMError("LLM_MALFORMED_RESPONSE", "Groq response was not valid JSON") from None
