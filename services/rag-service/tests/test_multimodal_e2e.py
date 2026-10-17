"""The acceptance test for the whole feature.

**A real cheap-tier call, against a real image.** Every other test in this
change asserts wiring: that the condition changed, that the part reached the
call, that the count is right. All of them pass against a model that looks at
the image and says nothing useful — and the context-only failure would still be
live, because retrieval would still find nothing and `corag.py` would still
return `DOC_MISSING` before generation ever ran.

So this one asserts the only thing that actually decides whether the feature
works: **a string that exists NOWHERE except inside the image comes out in the
reformulated query.** If this fails, the parts are arriving and doing nothing.

Skipped rather than failed without an API key or without poppler, because a
missing credential is not a broken feature; and, after three tries, when the
provider refuses with a transient status (503, 429): the pipeline then keeps the
raw message by design, and an outage at Google is not a broken feature either.

**A used-up daily quota skips at once**, with its own reason: no retry within
the run can outlast it. `scripts/check-pytest-skips.mjs` allows the busy skip
and fails this one, because the acceptance test then did not run for a reason
that holds all day.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone

import pytest

from rag_service.generation.parts import Attachment
from rag_service.preprocess.pipeline import PreprocessPipeline, Turn
from rag_service.retrieval.service import BudgetState
from rag_service.settings import resolve_ai_settings
from tests.images import png_showing, poppler_available

CYCLE = datetime(2026, 8, 1, tzinfo=timezone.utc)

#: **In the image and nowhere else.** Not in the message, not in the history,
#: not in the prompt — so the only route from here to the query runs through the
#: model's eyes. A code that also appeared in the text would let a model that
#: ignored the attachment entirely pass this test.
ONLY_IN_THE_IMAGE = "ERR_QUOTA_4021"

pytestmark = [
    pytest.mark.skipif(
        not os.environ.get("GEMINI_API_KEY"),
        reason="needs a real cheap-tier call",
    ),
    pytest.mark.skipif(
        not poppler_available(),
        reason="needs pdftoppm to render the fixture image",
    ),
]


#: What the provider says when it is busy rather than when the call is wrong.
TRANSIENT = ("503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED")

#: A per-day quota in the refusal's `QuotaFailure` (for example
#: `GenerateRequestsPerDayPerProjectPerModel-FreeTier`): spent until tomorrow.
DAILY_QUOTA = "PerDay"


async def run_live(pipeline, caplog, **kwargs):
    """`pipeline.run`, tried again when the provider was transiently busy.

    A refused call is logged by `MeteredGenerator` and the pipeline falls back
    to the raw message, which would read as the model ignoring the image (and
    pass the control for the wrong reason). Three tries, then a skip.
    """
    for attempt in range(3):
        caplog.clear()
        with caplog.at_level(logging.WARNING, logger="rag_service.ledger.metered"):
            result = await pipeline.run(**kwargs)
        refused = [
            record.getMessage()
            for record in caplog.records
            if any(status in record.getMessage() for status in TRANSIENT)
        ]
        if not refused:
            return result
        if any(DAILY_QUOTA in message for message in refused):
            pytest.skip(f"the Gemini key's daily quota is used up: {refused[0]}")
        await asyncio.sleep(5 * (attempt + 1))
    pytest.skip(f"the provider stayed busy for three tries: {refused[0]}")


class NullQuota:
    async def charge(self, *_args, **_kwargs):
        return None


@pytest.fixture
def live_pipeline(ledger):
    from rag_service.generation.gemini import GeminiGenerator

    return PreprocessPipeline(
        GeminiGenerator(os.environ["GEMINI_API_KEY"]), ledger, NullQuota()
    )


@pytest.fixture
def budget():
    return BudgetState(organization_id="org", cycle_start=CYCLE, allows_embedding=True)


@pytest.fixture
def screenshot() -> Attachment:
    return Attachment(
        mime_type="image/png",
        data=png_showing(ONLY_IN_THE_IMAGE),
        file_name="error.png",
    )


async def test_the_reformulated_query_carries_a_string_only_the_IMAGE_has(
    live_pipeline, screenshot, budget, caplog
):
    # The example, run for real: six words that name no product, no
    # error and no policy, plus the screenshot that names all three.
    result = await run_live(
        live_pipeline,
        caplog,
        message="how can I solve this problem?",
        history=[],
        settings=resolve_ai_settings("FAST"),
        budget=budget,
        attachments=[screenshot],
    )

    assert ONLY_IN_THE_IMAGE in result.query, (
        f"the model did not lift the code out of the image: {result.query!r}"
    )
    # And it stayed a QUERY rather than becoming a description of a screenshot.
    # Retrieval embeds this string; a sentence about a dialog box retrieves the
    # same nothing the original six words did.
    assert len(result.query) < 200


async def test_without_the_attachment_the_same_message_yields_nothing_to_search(
    live_pipeline, budget, caplog
):
    # The control, and the reason the test above means something. The same six
    # words with no file cannot produce the code — so a passing run above is the
    # image doing the work, not the model guessing from the prompt.
    result = await run_live(
        live_pipeline,
        caplog,
        message="how can I solve this problem?",
        history=[Turn(role="user", content="hello")],
        settings=resolve_ai_settings("FAST"),
        budget=budget,
    )

    assert ONLY_IN_THE_IMAGE not in result.query
