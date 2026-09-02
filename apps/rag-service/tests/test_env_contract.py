"""The environment contract, Python side: config.py is the code,
`.env.example` is the registry, and the scan runs from the code toward the
registry — the same rule the TypeScript services' guard enforces, in this
toolchain because this is this toolchain's file.

**Three patterns, not one, and the third is why this file is careful.**
`config.py` reads the environment through `os.environ["X"]`,
`os.environ.get("X", ...)`, and `_flag("X", ...)` — and in `_flag` the name
is a *parameter*, so a grep for literal `os.environ` structurally cannot see
the two variables that flow through it. Measured before this guard existed:
the naive scan reported eight, missed two, and the two it missed were the
injection-defence kill switches — security controls that appeared in no
`.env`, no example, and no scan.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
CONFIG_SOURCE = REPO_ROOT / "apps/rag-service/rag_service/config.py"
ENV_EXAMPLE = REPO_ROOT / "apps/rag-service/.env.example"

#: Every way config.py names an environment variable. A fourth accessor shape
#: added later is caught by the FLOOR below, not by these — the patterns catch
#: what exists, the floor catches what the patterns stopped catching.
READ_PATTERNS = (
    re.compile(r'os\.environ\[\s*"([A-Z][A-Z0-9_]*)"\s*\]'),
    re.compile(r'os\.environ\.get\(\s*"([A-Z][A-Z0-9_]*)"'),
    re.compile(r'_flag\(\s*"([A-Z][A-Z0-9_]*)"'),
)

#: The measured census the floor pins. Grows with the config; never shrinks.
FLOOR = 10


def declared_variables() -> set[str]:
    source = CONFIG_SOURCE.read_text()

    return {
        name
        for pattern in READ_PATTERNS
        for name in pattern.findall(source)
    }


def documented_variables() -> set[str]:
    """Active and commented-out `KEY =` lines — a commented `# REDIS_DB = 0`
    is how an optional variable becomes discoverable without being set, so it
    counts as documentation (the same rule as the TypeScript guard's)."""
    keys = set()

    for line in ENV_EXAMPLE.read_text().splitlines():
        match = re.match(r"#?\s*([A-Z][A-Z0-9_]*)\s*=", line.strip())
        if match:
            keys.add(match.group(1))

    return keys


def test_the_floor_holds() -> None:
    """At least ten variables found — a refactor that breaks a pattern (or
    routes reads through a fourth accessor) must fail here rather than shrink
    the census silently."""
    assert len(declared_variables()) >= FLOOR


def test_every_flag_read_is_seen() -> None:
    """The pattern that was missing when this mattered: `_flag` reads must be
    found by name, or the kill switches vanish from the census again."""
    declared = declared_variables()

    assert "INJECTION_REGEX_ENABLED" in declared
    assert "INJECTION_LLM_ENABLED" in declared


def test_every_declared_variable_is_documented() -> None:
    missing = sorted(declared_variables() - documented_variables())

    assert missing == [], f"read by config.py, absent from .env.example: {missing}"


def test_everything_documented_is_declared() -> None:
    phantom = sorted(documented_variables() - declared_variables())

    assert phantom == [], f"documented but read by nothing: {phantom}"
