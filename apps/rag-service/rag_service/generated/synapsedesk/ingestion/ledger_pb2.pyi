from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class AiGenerationPurpose(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    AI_GENERATION_PURPOSE_UNSPECIFIED: _ClassVar[AiGenerationPurpose]
    AI_GENERATION_PURPOSE_CHAT_ANSWER: _ClassVar[AiGenerationPurpose]
    AI_GENERATION_PURPOSE_DRAFT: _ClassVar[AiGenerationPurpose]
    AI_GENERATION_PURPOSE_SUMMARY: _ClassVar[AiGenerationPurpose]
    AI_GENERATION_PURPOSE_CLASSIFY: _ClassVar[AiGenerationPurpose]
    AI_GENERATION_PURPOSE_SUGGESTIONS: _ClassVar[AiGenerationPurpose]
    AI_GENERATION_PURPOSE_GREETING_CLASSIFY: _ClassVar[AiGenerationPurpose]
    AI_GENERATION_PURPOSE_REFORMULATION: _ClassVar[AiGenerationPurpose]
    AI_GENERATION_PURPOSE_EMBEDDING: _ClassVar[AiGenerationPurpose]
    AI_GENERATION_PURPOSE_REVIEW: _ClassVar[AiGenerationPurpose]

class AiGenerationStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    AI_GENERATION_STATUS_UNSPECIFIED: _ClassVar[AiGenerationStatus]
    AI_GENERATION_STATUS_SUCCESS: _ClassVar[AiGenerationStatus]
    AI_GENERATION_STATUS_FAILED: _ClassVar[AiGenerationStatus]
    AI_GENERATION_STATUS_CANCELLED: _ClassVar[AiGenerationStatus]
AI_GENERATION_PURPOSE_UNSPECIFIED: AiGenerationPurpose
AI_GENERATION_PURPOSE_CHAT_ANSWER: AiGenerationPurpose
AI_GENERATION_PURPOSE_DRAFT: AiGenerationPurpose
AI_GENERATION_PURPOSE_SUMMARY: AiGenerationPurpose
AI_GENERATION_PURPOSE_CLASSIFY: AiGenerationPurpose
AI_GENERATION_PURPOSE_SUGGESTIONS: AiGenerationPurpose
AI_GENERATION_PURPOSE_GREETING_CLASSIFY: AiGenerationPurpose
AI_GENERATION_PURPOSE_REFORMULATION: AiGenerationPurpose
AI_GENERATION_PURPOSE_EMBEDDING: AiGenerationPurpose
AI_GENERATION_PURPOSE_REVIEW: AiGenerationPurpose
AI_GENERATION_STATUS_UNSPECIFIED: AiGenerationStatus
AI_GENERATION_STATUS_SUCCESS: AiGenerationStatus
AI_GENERATION_STATUS_FAILED: AiGenerationStatus
AI_GENERATION_STATUS_CANCELLED: AiGenerationStatus

class RecordGenerationRequest(_message.Message):
    __slots__ = ("organization_id", "user_id", "ticket_id", "purpose", "model_name", "prompt_tokens", "completion_tokens", "latency_ms", "status", "content", "retrieved_chunk_ids", "cited_chunk_ids")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    TICKET_ID_FIELD_NUMBER: _ClassVar[int]
    PURPOSE_FIELD_NUMBER: _ClassVar[int]
    MODEL_NAME_FIELD_NUMBER: _ClassVar[int]
    PROMPT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    COMPLETION_TOKENS_FIELD_NUMBER: _ClassVar[int]
    LATENCY_MS_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    RETRIEVED_CHUNK_IDS_FIELD_NUMBER: _ClassVar[int]
    CITED_CHUNK_IDS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    user_id: str
    ticket_id: str
    purpose: str
    model_name: str
    prompt_tokens: int
    completion_tokens: int
    latency_ms: int
    status: str
    content: str
    retrieved_chunk_ids: _containers.RepeatedScalarFieldContainer[str]
    cited_chunk_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, organization_id: _Optional[str] = ..., user_id: _Optional[str] = ..., ticket_id: _Optional[str] = ..., purpose: _Optional[str] = ..., model_name: _Optional[str] = ..., prompt_tokens: _Optional[int] = ..., completion_tokens: _Optional[int] = ..., latency_ms: _Optional[int] = ..., status: _Optional[str] = ..., content: _Optional[str] = ..., retrieved_chunk_ids: _Optional[_Iterable[str]] = ..., cited_chunk_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class RecordGenerationResponse(_message.Message):
    __slots__ = ("generation_id",)
    GENERATION_ID_FIELD_NUMBER: _ClassVar[int]
    generation_id: str
    def __init__(self, generation_id: _Optional[str] = ...) -> None: ...

class RecordGenerationOutcomeRequest(_message.Message):
    __slots__ = ("generation_id", "resulting_message_id", "sent_text")
    GENERATION_ID_FIELD_NUMBER: _ClassVar[int]
    RESULTING_MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    SENT_TEXT_FIELD_NUMBER: _ClassVar[int]
    generation_id: str
    resulting_message_id: str
    sent_text: str
    def __init__(self, generation_id: _Optional[str] = ..., resulting_message_id: _Optional[str] = ..., sent_text: _Optional[str] = ...) -> None: ...

class RecordGenerationOutcomeResponse(_message.Message):
    __slots__ = ("outcome",)
    OUTCOME_FIELD_NUMBER: _ClassVar[int]
    outcome: str
    def __init__(self, outcome: _Optional[str] = ...) -> None: ...
