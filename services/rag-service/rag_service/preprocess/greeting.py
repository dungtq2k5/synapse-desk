"""Two-layer greeting detection, and the ORDER is the point.

    Layer 1 regex (FREE)
      └─ miss → Layer 2 classify (cheap LLM, ledgered)
           └─ FACTUAL → reformulation (LLM, ledgered)
                └─ embed → retrieve

**The free check runs first.** Every "thanks!" that reaches retrieval costs an
embedding, a Qdrant query, a rerank and a generation — all metered against the
tenant. Layer 1 costs a regex match.

**The reply is a canned lookup, not a generation**. Detecting a
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
    #: Refused by prompt-injection detection. Carries a `reply` like
    #: a greeting does, so it travels the same free short-circuit; the proto
    #: status is what keeps the two distinguishable downstream.
    REFUSED = "REFUSED"


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


#: What a refused question is told.
#:
#: **It names no pattern and no rule.** A message that explains what tripped the
#: detector is a free oracle for tuning an attack against it, and the tuning
#: costs the attacker nothing. The rephrasing hint is the half that matters for
#: everyone else: it is what makes a false positive recoverable by the user
#: rather than a dead end they cannot argue with.
#:
#: Keyed by language like `CANNED_REPLIES`, and populated for the same languages
#: — everything around this is multilingual by design, and a refusal is the
#: worst place to answer somebody in a language they did not write in.
REFUSAL_REPLIES: dict[str, str] = {
    "en": (
        "I can't help with that request. If this was a genuine question, try "
        "rephrasing it."
    ),
    "es": (
        "No puedo ayudarte con esa solicitud. Si era una pregunta legítima, "
        "prueba a reformularla."
    ),
    "fr": (
        "Je ne peux pas répondre à cette demande. S'il s'agissait d'une vraie "
        "question, essayez de la reformuler."
    ),
    "de": (
        "Bei dieser Anfrage kann ich nicht helfen. Wenn es eine echte Frage "
        "war, formulieren Sie sie bitte um."
    ),
    "pt": (
        "Não posso ajudar com esse pedido. Se era uma pergunta genuína, tente "
        "reformulá-la."
    ),
    "vi": (
        "Mình không thể hỗ trợ yêu cầu này. Nếu đây là một câu hỏi thật, bạn "
        "thử diễn đạt lại nhé."
    ),
    "ja": (
        "そのご依頼にはお答えできません。本来のご質問であれば、"
        "表現を変えてお試しください。"
    ),
    "zh": "我无法处理该请求。如果这是一个真实的问题，请尝试换一种说法。",
}


def refusal_reply(language: str | None) -> str:
    """The refusal, by language. English when neither layer could name one.

    **Both layers can name it**. Layer A knows the language of the
    pattern that fired; Layer B asks for it in the same eight-token answer, so
    `INJECTION es` costs exactly what `INJECTION` would have. That second half
    is what the cheap-tier classification bought: a classifier head returns a
    score and no language, which would have forced every Layer B refusal to
    English — the multilingual defect this system has already paid for once.

    English remains the fallback, not the default. This service has no language
    detector, so a message neither layer could place is answered in English
    rather than not answered.
    """
    return REFUSAL_REPLIES.get(language or "en", REFUSAL_REPLIES["en"])
