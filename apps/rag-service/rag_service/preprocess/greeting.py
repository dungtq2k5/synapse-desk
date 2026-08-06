"""Two-layer greeting detection — 13-doc §3.1, and the ORDER is the point.

    Layer 1 regex (FREE)
      └─ miss → Layer 2 classify (cheap LLM, ledgered)
           └─ FACTUAL → reformulation (LLM, ledgered)
                └─ embed → retrieve

**The free check runs first.** Every "thanks!" that reaches retrieval costs an
embedding, a Qdrant query, a rerank and a generation — all metered against the
tenant. Layer 1 costs a regex match.

**The reply is a canned lookup, not a generation** (11-doc §1.2). Detecting a
greeting for free and then paying a model to produce "Hi! How can I help?"
spends money on one of about six sentences. That is also why
`AiGenerationPurpose` has no `GREETING_REPLY` value — there is no spend to
record. If canned replies ever prove too rigid, adding the value and ledgering
the call is the change, rather than leaving an unmetered LLM call in the flow.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum


class Intent(StrEnum):
    GREETING = "GREETING"
    FACTUAL = "FACTUAL"


@dataclass(frozen=True)
class GreetingMatch:
    intent: Intent
    #: The language Layer 1 identified, used to pick the canned reply. `None`
    #: when Layer 2 decided, which is why the reply table has a default.
    language: str | None = None


#: **Multilingual, and that is not politeness — it is cost control.**
#:
#: An English-only list silently pushes every other language to Layer 2, so a
#: tenant operating in Spanish pays a cheap-model call for every "gracias" while
#: an English tenant pays nothing. The bill rises quietly and the cause looks
#: like usage rather than a regex.
GREETING_PATTERNS: dict[str, re.Pattern[str]] = {
    "en": re.compile(
        r"^(hi|hey|hello|yo|good\s+(morning|afternoon|evening)|thanks?|thank\s+you|"
        r"thx|ty|ok(ay)?|got\s+it|cheers|bye|goodbye|see\s+you|nice|great|"
        r"perfect|awesome|cool)\b",
        re.IGNORECASE,
    ),
    "es": re.compile(
        r"^(hola|buenos\s+d[ií]as|buenas\s+(tardes|noches)|gracias|"
        r"muchas\s+gracias|vale|adi[oó]s|hasta\s+luego|genial|perfecto)\b",
        re.IGNORECASE,
    ),
    "fr": re.compile(
        r"^(bonjour|salut|bonsoir|merci|merci\s+beaucoup|d'accord|au\s+revoir|"
        r"[àa]\s+bient[oô]t|super|parfait)\b",
        re.IGNORECASE,
    ),
    "de": re.compile(
        r"^(hallo|hi|guten\s+(morgen|tag|abend)|danke|vielen\s+dank|ok(ay)?|"
        r"tsch[üu]ss|auf\s+wiedersehen|super|perfekt)\b",
        re.IGNORECASE,
    ),
    "pt": re.compile(
        r"^(ol[áa]|oi|bom\s+dia|boa\s+(tarde|noite)|obrigad[oa]|valeu|"
        r"tchau|at[ée]\s+logo|[óo]timo|perfeito)\b",
        re.IGNORECASE,
    ),
    "vi": re.compile(
        r"^(ch[àa]o|xin\s+ch[àa]o|c[ảa]m\s+[ơo]n|c[áa]m\s+[ơo]n|"
        r"t[ạa]m\s+bi[ệe]t|[ừu]|[ồo]k|tuy[ệe]t)\b",
        re.IGNORECASE,
    ),
    "ja": re.compile(
        r"^(こんにちは|こんばんは|おはよう|ありがとう|どうも|さようなら|"
        r"了解|オーケー)",
    ),
    "zh": re.compile(r"^(你好|您好|早上好|晚上好|谢谢|多谢|再见|好的|明白)"),
}

#: The canned replies. Free, instant, and unaffected by the budget cap — so a
#: capped tenant's users still get a sensible answer to "thanks".
CANNED_REPLIES: dict[str, str] = {
    "en": "Hi! How can I help you today?",
    "es": "¡Hola! ¿En qué puedo ayudarte hoy?",
    "fr": "Bonjour ! Comment puis-je vous aider ?",
    "de": "Hallo! Wie kann ich Ihnen helfen?",
    "pt": "Olá! Como posso ajudar você hoje?",
    "vi": "Chào bạn! Mình có thể giúp gì cho bạn?",
    "ja": "こんにちは！どのようなご用件でしょうか？",
    "zh": "您好！有什么可以帮您的吗？",
}

#: How long a message can be and still be "just a greeting".
#:
#: **The guard against a greedy prefix match.** "hi, what's the refund policy?"
#: starts with a greeting and is a FACTUAL question; without a length bound the
#: regex would deflect it, and the user would get "Hi! How can I help?" in
#: response to having asked exactly that.
MAX_GREETING_WORDS = 4


def detect_greeting_layer_one(text: str) -> GreetingMatch | None:
    """The FREE check. Returns None on a miss, so Layer 2 can decide.

    Two conditions, and the second is the one that matters: the message must
    match a greeting pattern AND be short. A prefix match alone deflects every
    question that happens to open politely, which is a large fraction of the
    questions real users ask.
    """
    stripped = (text or "").strip()
    if not stripped:
        return None

    # Punctuation-only tails ("thanks!!!", "ok...") are still greetings, so the
    # word count is taken after stripping them rather than before.
    words = re.findall(r"\S+", re.sub(r"[!?.,;:]+", " ", stripped))
    if len(words) > MAX_GREETING_WORDS:
        return None

    for language, pattern in GREETING_PATTERNS.items():
        if pattern.match(stripped):
            return GreetingMatch(intent=Intent.GREETING, language=language)

    return None


def canned_reply(language: str | None) -> str:
    """The reply, by language. Falls back to English rather than to silence."""
    return CANNED_REPLIES.get(language or "en", CANNED_REPLIES["en"])
