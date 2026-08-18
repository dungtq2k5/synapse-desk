#!/usr/bin/env python
"""Every third-party import is declared in a requirements file.

**Written after two undeclared dependencies shipped.** `google-genai` and
`flashrank` were imported by `rag_service/` and named in nothing:
`requirements.txt` did not list them, `pyproject.toml` declares no
`dependencies`, and `pip show` reported `Required-by: []` for both — so a
from-scratch resolve produced 26 packages with neither in it. They worked only
because they sat in a developer's venv. `docker/rag-service.Dockerfile` installs
exactly `requirements.txt`, so the image shipped without them.

The two failed differently, and the second is why this check exists rather than
a note in a README:

  - `google-genai` is imported by `GeminiEmbeddingClient.__init__`, which
    `build_dependencies` calls at boot — a missing package is an ImportError on
    startup. Loud, immediate, obvious.
  - `flashrank` is imported inside `rerank()`, in a deliberately broad `except`
    that logs a warning and falls back to the fused order. With the package
    absent the process BOOTS, readiness reports SERVING, and every search runs
    permanently rerank-less behind one log line per request.

The lazy-import style that made the second one silent is also what makes a
grep-based check useless: the imports sit inside functions, not at module top.
This walks the AST, so nesting is irrelevant.

Run: `npm run lint:py` (chained), or `.venv/bin/python scripts/check-imports.py`.
"""

from __future__ import annotations

import ast
import importlib.util
import pathlib
import sys
from importlib.metadata import distributions

SERVICE_ROOT = pathlib.Path(__file__).resolve().parents[1]

#: Modules that are ours, so no distribution owns them.
FIRST_PARTY = {"rag_service", "tests"}

#: Never scanned. `generated/` is protoc output, rewritten on every
#: `npm run proto:generate`, and its imports are the protobuf runtime's problem.
EXCLUDED_PARTS = {"generated", "__pycache__", ".venv"}

#: The file `docker/rag-service.Dockerfile` installs — and the only one.
RUNTIME_REQUIREMENTS = "requirements.txt"

#: Checkers, stubs and the eval harness's YAML reader. Never in the image.
DEV_REQUIREMENTS = "requirements-dev.txt"

#: What a DEV tree may draw on: both files, because it runs on a machine where
#: both are installed.
DEV_AVAILABLE = (RUNTIME_REQUIREMENTS, DEV_REQUIREMENTS)

#: Which requirements file each source tree must be satisfied by.
#:
#: `rag_service/` is checked against the RUNTIME file alone, and that asymmetry
#: is the whole point rather than an oversight: the Dockerfile installs only
#: `requirements.txt`, so a runtime import satisfied by a dev dependency passes
#: every local check and is absent from the image — which is exactly the bug
#: that shipped.
SCOPES: list[tuple[str, tuple[str, ...]]] = [
    ("rag_service", (RUNTIME_REQUIREMENTS,)),
    ("tests", DEV_AVAILABLE),
    ("eval", DEV_AVAILABLE),
    ("scripts", DEV_AVAILABLE),
]


def normalize(name: str) -> str:
    """PEP 503 normalisation — `FlashRank` and `flashrank` are one package."""
    return name.lower().replace("_", "-").replace(".", "-")


def declared_in(*filenames: str) -> set[str]:
    """The distributions a requirements file pins."""
    names: set[str] = set()

    for filename in filenames:
        for raw in (SERVICE_ROOT / filename).read_text().splitlines():
            line = raw.split("#", 1)[0].strip()
            if not line:
                continue

            # `name==version`, `name>=version`, or a bare name. Splitting on the
            # first comparison character covers every form this repo uses, and
            # the repo pins exactly, so nothing exotic needs parsing.
            for separator in ("==", ">=", "<=", "~=", ">", "<", "["):
                if separator in line:
                    line = line.split(separator, 1)[0]
                    break

            names.add(normalize(line.strip()))

    return names


def build_owner_index() -> dict[str, str]:
    """Every installed FILE mapped to the distribution that owns it.

    **Paths rather than `packages_distributions()`**, which maps only top-level
    names — and `google` maps to three distributions at once (`google-genai`,
    `google-auth`, `protobuf`). That ambiguity is precisely what let
    `google-genai` hide: a top-level check sees `google` as covered because
    `protobuf` is installed. Resolving the full dotted path to a file, and the
    file to its owner, tells the three apart.
    """
    owner: dict[str, str] = {}

    for dist in distributions():
        name = dist.metadata["Name"]
        if not name:
            continue

        # `PackagePath.locate()` rather than joining onto `locate_file("")`:
        # that returns importlib's `SimplePath` protocol, which is not
        # `PathLike` and does not typecheck into `pathlib.Path`. `locate()` is
        # the API that exists for exactly this and hands back a real path.
        for relative in dist.files or []:
            owner[str(pathlib.Path(relative.locate()).resolve())] = name

    return owner


def imported_modules(tree: ast.AST) -> set[str]:
    """Every module this file imports, however deeply nested.

    `ast.walk` rather than reading `tree.body`: both undeclared packages were
    imported INSIDE a method, which a top-level scan would have missed entirely
    — and the lazy style is deliberate elsewhere too, because the reranker's
    model is tens of megabytes.

    Relative imports are skipped: `from .x import y` names no distribution.
    """
    modules: set[str] = set()

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and not node.level and node.module:
            # The DOTTED form only. `from google import genai` must be checked
            # as `google.genai`, never as bare `google`: `google` is a namespace
            # package with no `origin` of its own, so it resolves to nothing and
            # would report a false failure. `resolve` walks the path down from
            # the longest candidate, so `from redis import Redis` still falls
            # back to `redis` when `redis.Redis` is a class rather than a module.
            modules.update(f"{node.module}.{alias.name}" for alias in node.names)

    return modules


def resolve(module: str, owner: dict[str, str]) -> str | None:
    """The distribution owning `module`, or None if nothing does."""
    try:
        spec = importlib.util.find_spec(module)
    except (ImportError, AttributeError, ValueError):
        return None

    if spec is None or not spec.origin:
        return None

    return owner.get(str(pathlib.Path(spec.origin).resolve()))


def source_files(directory: str) -> list[pathlib.Path]:
    root = SERVICE_ROOT / directory
    if not root.exists():
        return []

    return [
        path
        for path in sorted(root.rglob("*.py"))
        if not EXCLUDED_PARTS & set(path.parts)
    ]


def main() -> int: # NOSONAR
    owner = build_owner_index()
    failures: list[str] = []
    checked = 0

    for directory, requirement_files in SCOPES:
        declared = declared_in(*requirement_files)

        for path in source_files(directory):
            try:
                tree = ast.parse(path.read_text(encoding="utf-8"))
            except SyntaxError as error:
                failures.append(f"{path}: could not parse ({error})")
                continue

            for module in sorted(imported_modules(tree)):
                top = module.split(".")[0]
                if top in sys.stdlib_module_names or top in FIRST_PARTY:
                    continue

                # Longest match first: `google.genai` before `google`, so the
                # namespace package resolves to the distribution that actually
                # owns the code being imported.
                parts = module.split(".")
                distribution = next(
                    (
                        found
                        for candidate in (
                            ".".join(parts[: length])
                            for length in range(len(parts), 0, -1)
                        )
                        if (found := resolve(candidate, owner))
                    ),
                    None,
                )

                checked += 1

                if distribution is None:
                    failures.append(
                        f"{path.relative_to(SERVICE_ROOT)}: `{module}` is imported "
                        "but no installed distribution owns it — it is missing "
                        "from the venv, or the name is wrong"
                    )
                elif normalize(distribution) not in declared:
                    failures.append(
                        f"{path.relative_to(SERVICE_ROOT)}: `{module}` comes from "
                        f"`{distribution}`, which is not declared in "
                        f"{' or '.join(requirement_files)}"
                    )

    if failures:
        print("Undeclared or unresolvable imports:\n")
        for failure in sorted(set(failures)):
            print(f"  {failure}")
        print(
            f"\n{len(set(failures))} problem(s). An import nothing declares is a "
            "package the Docker image will not contain."
        )
        return 1

    print(f"All {checked} third-party imports are declared.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
