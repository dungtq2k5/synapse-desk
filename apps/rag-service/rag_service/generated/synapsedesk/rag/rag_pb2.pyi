from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SearchDegradation(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SEARCH_DEGRADATION_UNSPECIFIED: _ClassVar[SearchDegradation]
    SEARCH_DEGRADATION_LEXICAL_ONLY: _ClassVar[SearchDegradation]

class AnswerStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ANSWER_STATUS_UNSPECIFIED: _ClassVar[AnswerStatus]
    ANSWER_STATUS_DOC_ANSWER: _ClassVar[AnswerStatus]
    ANSWER_STATUS_DOC_MISSING: _ClassVar[AnswerStatus]
    ANSWER_STATUS_GREETING: _ClassVar[AnswerStatus]
    ANSWER_STATUS_AT_CAP: _ClassVar[AnswerStatus]
    ANSWER_STATUS_REFUSED: _ClassVar[AnswerStatus]
SEARCH_DEGRADATION_UNSPECIFIED: SearchDegradation
SEARCH_DEGRADATION_LEXICAL_ONLY: SearchDegradation
ANSWER_STATUS_UNSPECIFIED: AnswerStatus
ANSWER_STATUS_DOC_ANSWER: AnswerStatus
ANSWER_STATUS_DOC_MISSING: AnswerStatus
ANSWER_STATUS_GREETING: AnswerStatus
ANSWER_STATUS_AT_CAP: AnswerStatus
ANSWER_STATUS_REFUSED: AnswerStatus

class SearchRequest(_message.Message):
    __slots__ = ("query", "limit", "skip_rerank")
    QUERY_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    SKIP_RERANK_FIELD_NUMBER: _ClassVar[int]
    query: str
    limit: int
    skip_rerank: bool
    def __init__(self, query: _Optional[str] = ..., limit: _Optional[int] = ..., skip_rerank: _Optional[bool] = ...) -> None: ...

class RetrievedChunk(_message.Message):
    __slots__ = ("chunk_id", "document_id", "document_title", "page_number", "chunk_index", "content_text", "score", "vector_point_id")
    CHUNK_ID_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_TITLE_FIELD_NUMBER: _ClassVar[int]
    PAGE_NUMBER_FIELD_NUMBER: _ClassVar[int]
    CHUNK_INDEX_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TEXT_FIELD_NUMBER: _ClassVar[int]
    SCORE_FIELD_NUMBER: _ClassVar[int]
    VECTOR_POINT_ID_FIELD_NUMBER: _ClassVar[int]
    chunk_id: str
    document_id: str
    document_title: str
    page_number: int
    chunk_index: int
    content_text: str
    score: float
    vector_point_id: str
    def __init__(self, chunk_id: _Optional[str] = ..., document_id: _Optional[str] = ..., document_title: _Optional[str] = ..., page_number: _Optional[int] = ..., chunk_index: _Optional[int] = ..., content_text: _Optional[str] = ..., score: _Optional[float] = ..., vector_point_id: _Optional[str] = ...) -> None: ...

class SearchResponse(_message.Message):
    __slots__ = ("chunks", "degraded")
    CHUNKS_FIELD_NUMBER: _ClassVar[int]
    DEGRADED_FIELD_NUMBER: _ClassVar[int]
    chunks: _containers.RepeatedCompositeFieldContainer[RetrievedChunk]
    degraded: SearchDegradation
    def __init__(self, chunks: _Optional[_Iterable[_Union[RetrievedChunk, _Mapping]]] = ..., degraded: _Optional[_Union[SearchDegradation, str]] = ...) -> None: ...

class ConversationTurn(_message.Message):
    __slots__ = ("role", "content")
    ROLE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    role: str
    content: str
    def __init__(self, role: _Optional[str] = ..., content: _Optional[str] = ...) -> None: ...

class AttachmentPart(_message.Message):
    __slots__ = ("mime_type", "data", "file_name")
    MIME_TYPE_FIELD_NUMBER: _ClassVar[int]
    DATA_FIELD_NUMBER: _ClassVar[int]
    FILE_NAME_FIELD_NUMBER: _ClassVar[int]
    mime_type: str
    data: bytes
    file_name: str
    def __init__(self, mime_type: _Optional[str] = ..., data: _Optional[bytes] = ..., file_name: _Optional[str] = ...) -> None: ...

class ChatRequest(_message.Message):
    __slots__ = ("message", "history", "ticket_id", "attachments", "attachment_count")
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    HISTORY_FIELD_NUMBER: _ClassVar[int]
    TICKET_ID_FIELD_NUMBER: _ClassVar[int]
    ATTACHMENTS_FIELD_NUMBER: _ClassVar[int]
    ATTACHMENT_COUNT_FIELD_NUMBER: _ClassVar[int]
    message: str
    history: _containers.RepeatedCompositeFieldContainer[ConversationTurn]
    ticket_id: str
    attachments: _containers.RepeatedCompositeFieldContainer[AttachmentPart]
    attachment_count: int
    def __init__(self, message: _Optional[str] = ..., history: _Optional[_Iterable[_Union[ConversationTurn, _Mapping]]] = ..., ticket_id: _Optional[str] = ..., attachments: _Optional[_Iterable[_Union[AttachmentPart, _Mapping]]] = ..., attachment_count: _Optional[int] = ...) -> None: ...

class Citation(_message.Message):
    __slots__ = ("chunk_id", "document_id", "document_title", "page_number", "vector_point_id")
    CHUNK_ID_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_TITLE_FIELD_NUMBER: _ClassVar[int]
    PAGE_NUMBER_FIELD_NUMBER: _ClassVar[int]
    VECTOR_POINT_ID_FIELD_NUMBER: _ClassVar[int]
    chunk_id: str
    document_id: str
    document_title: str
    page_number: int
    vector_point_id: str
    def __init__(self, chunk_id: _Optional[str] = ..., document_id: _Optional[str] = ..., document_title: _Optional[str] = ..., page_number: _Optional[int] = ..., vector_point_id: _Optional[str] = ...) -> None: ...

class ChatChunk(_message.Message):
    __slots__ = ("token", "completion")
    TOKEN_FIELD_NUMBER: _ClassVar[int]
    COMPLETION_FIELD_NUMBER: _ClassVar[int]
    token: str
    completion: ChatCompletion
    def __init__(self, token: _Optional[str] = ..., completion: _Optional[_Union[ChatCompletion, _Mapping]] = ...) -> None: ...

class ChatCompletion(_message.Message):
    __slots__ = ("status", "citations", "generation_id", "content")
    STATUS_FIELD_NUMBER: _ClassVar[int]
    CITATIONS_FIELD_NUMBER: _ClassVar[int]
    GENERATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    status: AnswerStatus
    citations: _containers.RepeatedCompositeFieldContainer[Citation]
    generation_id: str
    content: str
    def __init__(self, status: _Optional[_Union[AnswerStatus, str]] = ..., citations: _Optional[_Iterable[_Union[Citation, _Mapping]]] = ..., generation_id: _Optional[str] = ..., content: _Optional[str] = ...) -> None: ...

class DraftRequest(_message.Message):
    __slots__ = ("ticket_id", "history", "max_retries", "attachments")
    TICKET_ID_FIELD_NUMBER: _ClassVar[int]
    HISTORY_FIELD_NUMBER: _ClassVar[int]
    MAX_RETRIES_FIELD_NUMBER: _ClassVar[int]
    ATTACHMENTS_FIELD_NUMBER: _ClassVar[int]
    ticket_id: str
    history: _containers.RepeatedCompositeFieldContainer[ConversationTurn]
    max_retries: int
    attachments: _containers.RepeatedCompositeFieldContainer[AttachmentPart]
    def __init__(self, ticket_id: _Optional[str] = ..., history: _Optional[_Iterable[_Union[ConversationTurn, _Mapping]]] = ..., max_retries: _Optional[int] = ..., attachments: _Optional[_Iterable[_Union[AttachmentPart, _Mapping]]] = ...) -> None: ...

class DraftResponse(_message.Message):
    __slots__ = ("draft", "citations", "generation_id", "status")
    DRAFT_FIELD_NUMBER: _ClassVar[int]
    CITATIONS_FIELD_NUMBER: _ClassVar[int]
    GENERATION_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    draft: str
    citations: _containers.RepeatedCompositeFieldContainer[Citation]
    generation_id: str
    status: AnswerStatus
    def __init__(self, draft: _Optional[str] = ..., citations: _Optional[_Iterable[_Union[Citation, _Mapping]]] = ..., generation_id: _Optional[str] = ..., status: _Optional[_Union[AnswerStatus, str]] = ...) -> None: ...

class SummaryRequest(_message.Message):
    __slots__ = ("ticket_id", "history", "triggered_by_escalation")
    TICKET_ID_FIELD_NUMBER: _ClassVar[int]
    HISTORY_FIELD_NUMBER: _ClassVar[int]
    TRIGGERED_BY_ESCALATION_FIELD_NUMBER: _ClassVar[int]
    ticket_id: str
    history: _containers.RepeatedCompositeFieldContainer[ConversationTurn]
    triggered_by_escalation: bool
    def __init__(self, ticket_id: _Optional[str] = ..., history: _Optional[_Iterable[_Union[ConversationTurn, _Mapping]]] = ..., triggered_by_escalation: _Optional[bool] = ...) -> None: ...

class SummaryResponse(_message.Message):
    __slots__ = ("summary_text", "suggested_action", "confidence_score", "model_name", "generation_id")
    SUMMARY_TEXT_FIELD_NUMBER: _ClassVar[int]
    SUGGESTED_ACTION_FIELD_NUMBER: _ClassVar[int]
    CONFIDENCE_SCORE_FIELD_NUMBER: _ClassVar[int]
    MODEL_NAME_FIELD_NUMBER: _ClassVar[int]
    GENERATION_ID_FIELD_NUMBER: _ClassVar[int]
    summary_text: str
    suggested_action: str
    confidence_score: float
    model_name: str
    generation_id: str
    def __init__(self, summary_text: _Optional[str] = ..., suggested_action: _Optional[str] = ..., confidence_score: _Optional[float] = ..., model_name: _Optional[str] = ..., generation_id: _Optional[str] = ...) -> None: ...

class ClassifyRequest(_message.Message):
    __slots__ = ("ticket_id", "title", "body", "departments", "attachments")
    TICKET_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    BODY_FIELD_NUMBER: _ClassVar[int]
    DEPARTMENTS_FIELD_NUMBER: _ClassVar[int]
    ATTACHMENTS_FIELD_NUMBER: _ClassVar[int]
    ticket_id: str
    title: str
    body: str
    departments: _containers.RepeatedCompositeFieldContainer[DepartmentOption]
    attachments: _containers.RepeatedCompositeFieldContainer[AttachmentPart]
    def __init__(self, ticket_id: _Optional[str] = ..., title: _Optional[str] = ..., body: _Optional[str] = ..., departments: _Optional[_Iterable[_Union[DepartmentOption, _Mapping]]] = ..., attachments: _Optional[_Iterable[_Union[AttachmentPart, _Mapping]]] = ...) -> None: ...

class DepartmentOption(_message.Message):
    __slots__ = ("id", "name")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ...) -> None: ...

class ClassifyResponse(_message.Message):
    __slots__ = ("suggested_department_id", "suggested_priority", "confidence_score", "generation_id")
    SUGGESTED_DEPARTMENT_ID_FIELD_NUMBER: _ClassVar[int]
    SUGGESTED_PRIORITY_FIELD_NUMBER: _ClassVar[int]
    CONFIDENCE_SCORE_FIELD_NUMBER: _ClassVar[int]
    GENERATION_ID_FIELD_NUMBER: _ClassVar[int]
    suggested_department_id: str
    suggested_priority: str
    confidence_score: float
    generation_id: str
    def __init__(self, suggested_department_id: _Optional[str] = ..., suggested_priority: _Optional[str] = ..., confidence_score: _Optional[float] = ..., generation_id: _Optional[str] = ...) -> None: ...

class SuggestionsRequest(_message.Message):
    __slots__ = ("ticket_id", "history", "title", "body")
    TICKET_ID_FIELD_NUMBER: _ClassVar[int]
    HISTORY_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    BODY_FIELD_NUMBER: _ClassVar[int]
    ticket_id: str
    history: _containers.RepeatedCompositeFieldContainer[ConversationTurn]
    title: str
    body: str
    def __init__(self, ticket_id: _Optional[str] = ..., history: _Optional[_Iterable[_Union[ConversationTurn, _Mapping]]] = ..., title: _Optional[str] = ..., body: _Optional[str] = ...) -> None: ...

class Suggestion(_message.Message):
    __slots__ = ("title", "body", "confidence_score", "citations")
    TITLE_FIELD_NUMBER: _ClassVar[int]
    BODY_FIELD_NUMBER: _ClassVar[int]
    CONFIDENCE_SCORE_FIELD_NUMBER: _ClassVar[int]
    CITATIONS_FIELD_NUMBER: _ClassVar[int]
    title: str
    body: str
    confidence_score: float
    citations: _containers.RepeatedCompositeFieldContainer[Citation]
    def __init__(self, title: _Optional[str] = ..., body: _Optional[str] = ..., confidence_score: _Optional[float] = ..., citations: _Optional[_Iterable[_Union[Citation, _Mapping]]] = ...) -> None: ...

class SuggestionsResponse(_message.Message):
    __slots__ = ("suggestions", "generation_id", "articles", "degraded")
    SUGGESTIONS_FIELD_NUMBER: _ClassVar[int]
    GENERATION_ID_FIELD_NUMBER: _ClassVar[int]
    ARTICLES_FIELD_NUMBER: _ClassVar[int]
    DEGRADED_FIELD_NUMBER: _ClassVar[int]
    suggestions: _containers.RepeatedCompositeFieldContainer[Suggestion]
    generation_id: str
    articles: _containers.RepeatedCompositeFieldContainer[SuggestedArticle]
    degraded: SearchDegradation
    def __init__(self, suggestions: _Optional[_Iterable[_Union[Suggestion, _Mapping]]] = ..., generation_id: _Optional[str] = ..., articles: _Optional[_Iterable[_Union[SuggestedArticle, _Mapping]]] = ..., degraded: _Optional[_Union[SearchDegradation, str]] = ...) -> None: ...

class SuggestedArticle(_message.Message):
    __slots__ = ("document_id", "document_title", "page_number", "score")
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_TITLE_FIELD_NUMBER: _ClassVar[int]
    PAGE_NUMBER_FIELD_NUMBER: _ClassVar[int]
    SCORE_FIELD_NUMBER: _ClassVar[int]
    document_id: str
    document_title: str
    page_number: int
    score: float
    def __init__(self, document_id: _Optional[str] = ..., document_title: _Optional[str] = ..., page_number: _Optional[int] = ..., score: _Optional[float] = ...) -> None: ...

class ChatResponse(_message.Message):
    __slots__ = ("content", "status", "citations", "generation_id")
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    CITATIONS_FIELD_NUMBER: _ClassVar[int]
    GENERATION_ID_FIELD_NUMBER: _ClassVar[int]
    content: str
    status: AnswerStatus
    citations: _containers.RepeatedCompositeFieldContainer[Citation]
    generation_id: str
    def __init__(self, content: _Optional[str] = ..., status: _Optional[_Union[AnswerStatus, str]] = ..., citations: _Optional[_Iterable[_Union[Citation, _Mapping]]] = ..., generation_id: _Optional[str] = ...) -> None: ...
