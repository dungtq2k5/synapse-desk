"""Test doubles shared by `conftest.py` and the suites.

**Not in `conftest.py`, and that is the whole reason this file exists.** pytest
imports a conftest under the bare name `conftest` while a test module importing
`from tests.conftest import X` gets a SECOND module object — so the two `X`
classes are unrelated, and `pytest.raises(X)` fails to catch the one the fixture
raised. The traceback then shows the exception it was supposedly looking for,
which is about as confusing as a test failure gets.

Importing this module by one absolute path from both places gives one class.
"""

from __future__ import annotations

from dataclasses import dataclass

import grpc


@dataclass
class FakeAbort(Exception):
    """What the fake servicer context raises instead of aborting a real call.

    A real `context.abort()` raises inside grpc's machinery and never returns;
    this keeps that "control flow ends here" property, so a servicer that
    aborted and then carried on would fail rather than quietly returning a
    half-built response.
    """

    #: The gRPC status the servicer aborted with. Typed rather than `object`
    #: so `raised.value.code.name` is checkable — every assertion on this
    #: reads `.name`, which `object` does not have.
    code: grpc.StatusCode
    details: str
