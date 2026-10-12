"""The entrypoint runs last

`python -m rag_service.server` executes the module top to bottom and blocks in
`serve()`. A definition below the `__main__` guard is never reached in the
running service, while every test (which imports the module) still sees it: the
`Chat` handler raised `NameError: _attachments_of` on every request that way.
"""

from __future__ import annotations

import ast
from pathlib import Path

import rag_service.server


def test_the_main_guard_is_the_modules_last_statement():
    tree = ast.parse(Path(rag_service.server.__file__).read_text())
    last = tree.body[-1]

    assert isinstance(last, ast.If)
    assert ast.unparse(last.test) == "__name__ == '__main__'"
