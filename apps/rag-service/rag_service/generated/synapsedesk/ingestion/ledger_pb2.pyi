import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

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
    AI_GENERATION_PURPOSE_INJECTION_CLASSIFY: _ClassVar[AiGenerationPurpose]

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
AI_GENERATION_PURPOSE_INJECTION_CLASSIFY: AiGenerationPurpose
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

class AiUsageRequest(_message.Message):
    __slots__ = ("to", "granularity")
    FROM_FIELD_NUMBER: _ClassVar[int]
    TO_FIELD_NUMBER: _ClassVar[int]
    GRANULARITY_FIELD_NUMBER: _ClassVar[int]
    to: str
    granularity: str
    def __init__(self, to: _Optional[str] = ..., granularity: _Optional[str] = ..., **kwargs) -> None: ...

class AiUsageSlice(_message.Message):
    __slots__ = ("purpose", "model_name", "generations", "prompt_tokens", "completion_tokens", "cost_micros", "latency_ms", "failure_rate")
    PURPOSE_FIELD_NUMBER: _ClassVar[int]
    MODEL_NAME_FIELD_NUMBER: _ClassVar[int]
    GENERATIONS_FIELD_NUMBER: _ClassVar[int]
    PROMPT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    COMPLETION_TOKENS_FIELD_NUMBER: _ClassVar[int]
    COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    LATENCY_MS_FIELD_NUMBER: _ClassVar[int]
    FAILURE_RATE_FIELD_NUMBER: _ClassVar[int]
    purpose: str
    model_name: str
    generations: int
    prompt_tokens: int
    completion_tokens: int
    cost_micros: int
    latency_ms: AiMeanValue
    failure_rate: AiRateValue
    def __init__(self, purpose: _Optional[str] = ..., model_name: _Optional[str] = ..., generations: _Optional[int] = ..., prompt_tokens: _Optional[int] = ..., completion_tokens: _Optional[int] = ..., cost_micros: _Optional[int] = ..., latency_ms: _Optional[_Union[AiMeanValue, _Mapping]] = ..., failure_rate: _Optional[_Union[AiRateValue, _Mapping]] = ...) -> None: ...

class AiUsagePoint(_message.Message):
    __slots__ = ("day", "generations", "cost_micros")
    DAY_FIELD_NUMBER: _ClassVar[int]
    GENERATIONS_FIELD_NUMBER: _ClassVar[int]
    COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    day: str
    generations: int
    cost_micros: int
    def __init__(self, day: _Optional[str] = ..., generations: _Optional[int] = ..., cost_micros: _Optional[int] = ...) -> None: ...

class AiUsageResponse(_message.Message):
    __slots__ = ("points", "by_purpose", "by_model", "total_cost_micros", "total_generations", "monthly_budget_micros", "ai_model_tier", "draft_acceptance", "empty_retrieval_rate", "computed_at", "data_through")
    POINTS_FIELD_NUMBER: _ClassVar[int]
    BY_PURPOSE_FIELD_NUMBER: _ClassVar[int]
    BY_MODEL_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_GENERATIONS_FIELD_NUMBER: _ClassVar[int]
    MONTHLY_BUDGET_MICROS_FIELD_NUMBER: _ClassVar[int]
    AI_MODEL_TIER_FIELD_NUMBER: _ClassVar[int]
    DRAFT_ACCEPTANCE_FIELD_NUMBER: _ClassVar[int]
    EMPTY_RETRIEVAL_RATE_FIELD_NUMBER: _ClassVar[int]
    COMPUTED_AT_FIELD_NUMBER: _ClassVar[int]
    DATA_THROUGH_FIELD_NUMBER: _ClassVar[int]
    points: _containers.RepeatedCompositeFieldContainer[AiUsagePoint]
    by_purpose: _containers.RepeatedCompositeFieldContainer[AiUsageSlice]
    by_model: _containers.RepeatedCompositeFieldContainer[AiUsageSlice]
    total_cost_micros: int
    total_generations: int
    monthly_budget_micros: int
    ai_model_tier: str
    draft_acceptance: AiRateValue
    empty_retrieval_rate: AiRateValue
    computed_at: _timestamp_pb2.Timestamp
    data_through: str
    def __init__(self, points: _Optional[_Iterable[_Union[AiUsagePoint, _Mapping]]] = ..., by_purpose: _Optional[_Iterable[_Union[AiUsageSlice, _Mapping]]] = ..., by_model: _Optional[_Iterable[_Union[AiUsageSlice, _Mapping]]] = ..., total_cost_micros: _Optional[int] = ..., total_generations: _Optional[int] = ..., monthly_budget_micros: _Optional[int] = ..., ai_model_tier: _Optional[str] = ..., draft_acceptance: _Optional[_Union[AiRateValue, _Mapping]] = ..., empty_retrieval_rate: _Optional[_Union[AiRateValue, _Mapping]] = ..., computed_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., data_through: _Optional[str] = ...) -> None: ...

class KnowledgeGapsRequest(_message.Message):
    __slots__ = ("to", "limit")
    FROM_FIELD_NUMBER: _ClassVar[int]
    TO_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    to: str
    limit: int
    def __init__(self, to: _Optional[str] = ..., limit: _Optional[int] = ..., **kwargs) -> None: ...

class KnowledgeGapDocumentFlag(_message.Message):
    __slots__ = ("document_id", "document_title", "flag_type", "detail")
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_TITLE_FIELD_NUMBER: _ClassVar[int]
    FLAG_TYPE_FIELD_NUMBER: _ClassVar[int]
    DETAIL_FIELD_NUMBER: _ClassVar[int]
    document_id: str
    document_title: str
    flag_type: str
    detail: str
    def __init__(self, document_id: _Optional[str] = ..., document_title: _Optional[str] = ..., flag_type: _Optional[str] = ..., detail: _Optional[str] = ...) -> None: ...

class KnowledgeGapsResponse(_message.Message):
    __slots__ = ("empty_retrievals", "answering_generations", "empty_retrieval_rate", "flags", "data_through")
    EMPTY_RETRIEVALS_FIELD_NUMBER: _ClassVar[int]
    ANSWERING_GENERATIONS_FIELD_NUMBER: _ClassVar[int]
    EMPTY_RETRIEVAL_RATE_FIELD_NUMBER: _ClassVar[int]
    FLAGS_FIELD_NUMBER: _ClassVar[int]
    DATA_THROUGH_FIELD_NUMBER: _ClassVar[int]
    empty_retrievals: int
    answering_generations: int
    empty_retrieval_rate: AiRateValue
    flags: _containers.RepeatedCompositeFieldContainer[KnowledgeGapDocumentFlag]
    data_through: str
    def __init__(self, empty_retrievals: _Optional[int] = ..., answering_generations: _Optional[int] = ..., empty_retrieval_rate: _Optional[_Union[AiRateValue, _Mapping]] = ..., flags: _Optional[_Iterable[_Union[KnowledgeGapDocumentFlag, _Mapping]]] = ..., data_through: _Optional[str] = ...) -> None: ...

class DocumentAnalyticsRequest(_message.Message):
    __slots__ = ("limit",)
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    limit: int
    def __init__(self, limit: _Optional[int] = ...) -> None: ...

class DocumentUsageStat(_message.Message):
    __slots__ = ("document_id", "title", "retrieval_count", "citation_count", "chunk_count")
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    RETRIEVAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    CITATION_COUNT_FIELD_NUMBER: _ClassVar[int]
    CHUNK_COUNT_FIELD_NUMBER: _ClassVar[int]
    document_id: str
    title: str
    retrieval_count: int
    citation_count: int
    chunk_count: int
    def __init__(self, document_id: _Optional[str] = ..., title: _Optional[str] = ..., retrieval_count: _Optional[int] = ..., citation_count: _Optional[int] = ..., chunk_count: _Optional[int] = ...) -> None: ...

class DocumentAnalyticsResponse(_message.Message):
    __slots__ = ("most_cited", "never_retrieved", "retrieved_never_cited", "data_through")
    MOST_CITED_FIELD_NUMBER: _ClassVar[int]
    NEVER_RETRIEVED_FIELD_NUMBER: _ClassVar[int]
    RETRIEVED_NEVER_CITED_FIELD_NUMBER: _ClassVar[int]
    DATA_THROUGH_FIELD_NUMBER: _ClassVar[int]
    most_cited: _containers.RepeatedCompositeFieldContainer[DocumentUsageStat]
    never_retrieved: _containers.RepeatedCompositeFieldContainer[DocumentUsageStat]
    retrieved_never_cited: _containers.RepeatedCompositeFieldContainer[DocumentUsageStat]
    data_through: str
    def __init__(self, most_cited: _Optional[_Iterable[_Union[DocumentUsageStat, _Mapping]]] = ..., never_retrieved: _Optional[_Iterable[_Union[DocumentUsageStat, _Mapping]]] = ..., retrieved_never_cited: _Optional[_Iterable[_Union[DocumentUsageStat, _Mapping]]] = ..., data_through: _Optional[str] = ...) -> None: ...

class AiJobHealthRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class AiJobRunStatus(_message.Message):
    __slots__ = ("job_name", "last_started_at", "last_succeeded_at", "last_duration_ms", "last_error", "consecutive_failures")
    JOB_NAME_FIELD_NUMBER: _ClassVar[int]
    LAST_STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_SUCCEEDED_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    LAST_ERROR_FIELD_NUMBER: _ClassVar[int]
    CONSECUTIVE_FAILURES_FIELD_NUMBER: _ClassVar[int]
    job_name: str
    last_started_at: _timestamp_pb2.Timestamp
    last_succeeded_at: _timestamp_pb2.Timestamp
    last_duration_ms: int
    last_error: str
    consecutive_failures: int
    def __init__(self, job_name: _Optional[str] = ..., last_started_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_succeeded_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_duration_ms: _Optional[int] = ..., last_error: _Optional[str] = ..., consecutive_failures: _Optional[int] = ...) -> None: ...

class AiJobHealthResponse(_message.Message):
    __slots__ = ("items",)
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    items: _containers.RepeatedCompositeFieldContainer[AiJobRunStatus]
    def __init__(self, items: _Optional[_Iterable[_Union[AiJobRunStatus, _Mapping]]] = ...) -> None: ...

class RunAiRollupRequest(_message.Message):
    __slots__ = ("to",)
    FROM_FIELD_NUMBER: _ClassVar[int]
    TO_FIELD_NUMBER: _ClassVar[int]
    to: str
    def __init__(self, to: _Optional[str] = ..., **kwargs) -> None: ...

class RunAiRollupResponse(_message.Message):
    __slots__ = ("tenants", "rows")
    TENANTS_FIELD_NUMBER: _ClassVar[int]
    ROWS_FIELD_NUMBER: _ClassVar[int]
    tenants: int
    rows: int
    def __init__(self, tenants: _Optional[int] = ..., rows: _Optional[int] = ...) -> None: ...

class AiRateValue(_message.Message):
    __slots__ = ("rate", "numerator", "denominator")
    RATE_FIELD_NUMBER: _ClassVar[int]
    NUMERATOR_FIELD_NUMBER: _ClassVar[int]
    DENOMINATOR_FIELD_NUMBER: _ClassVar[int]
    rate: float
    numerator: int
    denominator: int
    def __init__(self, rate: _Optional[float] = ..., numerator: _Optional[int] = ..., denominator: _Optional[int] = ...) -> None: ...

class AiMeanValue(_message.Message):
    __slots__ = ("mean", "count")
    MEAN_FIELD_NUMBER: _ClassVar[int]
    COUNT_FIELD_NUMBER: _ClassVar[int]
    mean: float
    count: int
    def __init__(self, mean: _Optional[float] = ..., count: _Optional[int] = ...) -> None: ...
