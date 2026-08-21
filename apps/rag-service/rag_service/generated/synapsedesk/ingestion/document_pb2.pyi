import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from rag_service.generated.synapsedesk.auth import common_pb2 as _common_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class DocumentStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    DOCUMENT_STATUS_UNSPECIFIED: _ClassVar[DocumentStatus]
    DOCUMENT_STATUS_PENDING: _ClassVar[DocumentStatus]
    DOCUMENT_STATUS_PROCESSING: _ClassVar[DocumentStatus]
    DOCUMENT_STATUS_INDEXED: _ClassVar[DocumentStatus]
    DOCUMENT_STATUS_FAILED: _ClassVar[DocumentStatus]

class IngestionJobStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    INGESTION_JOB_STATUS_UNSPECIFIED: _ClassVar[IngestionJobStatus]
    INGESTION_JOB_STATUS_QUEUED: _ClassVar[IngestionJobStatus]
    INGESTION_JOB_STATUS_PARSING: _ClassVar[IngestionJobStatus]
    INGESTION_JOB_STATUS_CHUNKING: _ClassVar[IngestionJobStatus]
    INGESTION_JOB_STATUS_EMBEDDING: _ClassVar[IngestionJobStatus]
    INGESTION_JOB_STATUS_COMPLETED: _ClassVar[IngestionJobStatus]
    INGESTION_JOB_STATUS_FAILED: _ClassVar[IngestionJobStatus]
    INGESTION_JOB_STATUS_CANCELLED: _ClassVar[IngestionJobStatus]

class DocumentFileType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    DOCUMENT_FILE_TYPE_UNSPECIFIED: _ClassVar[DocumentFileType]
    DOCUMENT_FILE_TYPE_PDF: _ClassVar[DocumentFileType]
    DOCUMENT_FILE_TYPE_TXT: _ClassVar[DocumentFileType]
    DOCUMENT_FILE_TYPE_MD: _ClassVar[DocumentFileType]
    DOCUMENT_FILE_TYPE_BIN: _ClassVar[DocumentFileType]
    DOCUMENT_FILE_TYPE_DOC: _ClassVar[DocumentFileType]
    DOCUMENT_FILE_TYPE_DOCX: _ClassVar[DocumentFileType]

class DocumentFlagType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    DOCUMENT_FLAG_TYPE_UNSPECIFIED: _ClassVar[DocumentFlagType]
    DOCUMENT_FLAG_TYPE_OUTDATED: _ClassVar[DocumentFlagType]
    DOCUMENT_FLAG_TYPE_UNRETRIEVED: _ClassVar[DocumentFlagType]
    DOCUMENT_FLAG_TYPE_UNCITED: _ClassVar[DocumentFlagType]
    DOCUMENT_FLAG_TYPE_LOW_CONFIDENCE: _ClassVar[DocumentFlagType]
    DOCUMENT_FLAG_TYPE_NEGATIVE_FEEDBACK: _ClassVar[DocumentFlagType]
    DOCUMENT_FLAG_TYPE_CONFLICTING: _ClassVar[DocumentFlagType]
    DOCUMENT_FLAG_TYPE_PAGES_NOT_INDEXED: _ClassVar[DocumentFlagType]

class DocumentFlagResolution(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    DOCUMENT_FLAG_RESOLUTION_UNSPECIFIED: _ClassVar[DocumentFlagResolution]
    DOCUMENT_FLAG_RESOLUTION_FIXED: _ClassVar[DocumentFlagResolution]
    DOCUMENT_FLAG_RESOLUTION_DISMISSED: _ClassVar[DocumentFlagResolution]
    DOCUMENT_FLAG_RESOLUTION_DOCUMENT_REPLACED: _ClassVar[DocumentFlagResolution]

class DocumentFlagSeverity(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    DOCUMENT_FLAG_SEVERITY_UNSPECIFIED: _ClassVar[DocumentFlagSeverity]
    DOCUMENT_FLAG_SEVERITY_INFO: _ClassVar[DocumentFlagSeverity]
    DOCUMENT_FLAG_SEVERITY_WARNING: _ClassVar[DocumentFlagSeverity]
    DOCUMENT_FLAG_SEVERITY_CRITICAL: _ClassVar[DocumentFlagSeverity]
DOCUMENT_STATUS_UNSPECIFIED: DocumentStatus
DOCUMENT_STATUS_PENDING: DocumentStatus
DOCUMENT_STATUS_PROCESSING: DocumentStatus
DOCUMENT_STATUS_INDEXED: DocumentStatus
DOCUMENT_STATUS_FAILED: DocumentStatus
INGESTION_JOB_STATUS_UNSPECIFIED: IngestionJobStatus
INGESTION_JOB_STATUS_QUEUED: IngestionJobStatus
INGESTION_JOB_STATUS_PARSING: IngestionJobStatus
INGESTION_JOB_STATUS_CHUNKING: IngestionJobStatus
INGESTION_JOB_STATUS_EMBEDDING: IngestionJobStatus
INGESTION_JOB_STATUS_COMPLETED: IngestionJobStatus
INGESTION_JOB_STATUS_FAILED: IngestionJobStatus
INGESTION_JOB_STATUS_CANCELLED: IngestionJobStatus
DOCUMENT_FILE_TYPE_UNSPECIFIED: DocumentFileType
DOCUMENT_FILE_TYPE_PDF: DocumentFileType
DOCUMENT_FILE_TYPE_TXT: DocumentFileType
DOCUMENT_FILE_TYPE_MD: DocumentFileType
DOCUMENT_FILE_TYPE_BIN: DocumentFileType
DOCUMENT_FILE_TYPE_DOC: DocumentFileType
DOCUMENT_FILE_TYPE_DOCX: DocumentFileType
DOCUMENT_FLAG_TYPE_UNSPECIFIED: DocumentFlagType
DOCUMENT_FLAG_TYPE_OUTDATED: DocumentFlagType
DOCUMENT_FLAG_TYPE_UNRETRIEVED: DocumentFlagType
DOCUMENT_FLAG_TYPE_UNCITED: DocumentFlagType
DOCUMENT_FLAG_TYPE_LOW_CONFIDENCE: DocumentFlagType
DOCUMENT_FLAG_TYPE_NEGATIVE_FEEDBACK: DocumentFlagType
DOCUMENT_FLAG_TYPE_CONFLICTING: DocumentFlagType
DOCUMENT_FLAG_TYPE_PAGES_NOT_INDEXED: DocumentFlagType
DOCUMENT_FLAG_RESOLUTION_UNSPECIFIED: DocumentFlagResolution
DOCUMENT_FLAG_RESOLUTION_FIXED: DocumentFlagResolution
DOCUMENT_FLAG_RESOLUTION_DISMISSED: DocumentFlagResolution
DOCUMENT_FLAG_RESOLUTION_DOCUMENT_REPLACED: DocumentFlagResolution
DOCUMENT_FLAG_SEVERITY_UNSPECIFIED: DocumentFlagSeverity
DOCUMENT_FLAG_SEVERITY_INFO: DocumentFlagSeverity
DOCUMENT_FLAG_SEVERITY_WARNING: DocumentFlagSeverity
DOCUMENT_FLAG_SEVERITY_CRITICAL: DocumentFlagSeverity

class DocumentResponse(_message.Message):
    __slots__ = ("id", "organization_id", "created_by_id", "title", "file_url", "file_type", "file_size_bytes", "is_organization_wide", "status", "department_ids", "chunk_count", "created_at", "updated_at", "deleted_at", "deleted_by_id", "ocr_languages")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CREATED_BY_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    FILE_URL_FIELD_NUMBER: _ClassVar[int]
    FILE_TYPE_FIELD_NUMBER: _ClassVar[int]
    FILE_SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    IS_ORGANIZATION_WIDE_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    DEPARTMENT_IDS_FIELD_NUMBER: _ClassVar[int]
    CHUNK_COUNT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    DELETED_AT_FIELD_NUMBER: _ClassVar[int]
    DELETED_BY_ID_FIELD_NUMBER: _ClassVar[int]
    OCR_LANGUAGES_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    created_by_id: str
    title: str
    file_url: str
    file_type: DocumentFileType
    file_size_bytes: int
    is_organization_wide: bool
    status: DocumentStatus
    department_ids: _containers.RepeatedScalarFieldContainer[str]
    chunk_count: int
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    deleted_at: _timestamp_pb2.Timestamp
    deleted_by_id: str
    ocr_languages: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., created_by_id: _Optional[str] = ..., title: _Optional[str] = ..., file_url: _Optional[str] = ..., file_type: _Optional[_Union[DocumentFileType, str]] = ..., file_size_bytes: _Optional[int] = ..., is_organization_wide: _Optional[bool] = ..., status: _Optional[_Union[DocumentStatus, str]] = ..., department_ids: _Optional[_Iterable[str]] = ..., chunk_count: _Optional[int] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., deleted_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., deleted_by_id: _Optional[str] = ..., ocr_languages: _Optional[_Iterable[str]] = ...) -> None: ...

class PresignDocumentRequest(_message.Message):
    __slots__ = ("content_type", "size_bytes", "file_name")
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    FILE_NAME_FIELD_NUMBER: _ClassVar[int]
    content_type: str
    size_bytes: int
    file_name: str
    def __init__(self, content_type: _Optional[str] = ..., size_bytes: _Optional[int] = ..., file_name: _Optional[str] = ...) -> None: ...

class PresignDocumentResponse(_message.Message):
    __slots__ = ("upload_url", "object_path", "expires_at")
    UPLOAD_URL_FIELD_NUMBER: _ClassVar[int]
    OBJECT_PATH_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    upload_url: str
    object_path: str
    expires_at: _timestamp_pb2.Timestamp
    def __init__(self, upload_url: _Optional[str] = ..., object_path: _Optional[str] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ConfirmDocumentRequest(_message.Message):
    __slots__ = ("object_path", "title", "is_organization_wide", "department_ids", "file_name", "ocr_languages")
    OBJECT_PATH_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    IS_ORGANIZATION_WIDE_FIELD_NUMBER: _ClassVar[int]
    DEPARTMENT_IDS_FIELD_NUMBER: _ClassVar[int]
    FILE_NAME_FIELD_NUMBER: _ClassVar[int]
    OCR_LANGUAGES_FIELD_NUMBER: _ClassVar[int]
    object_path: str
    title: str
    is_organization_wide: bool
    department_ids: _containers.RepeatedScalarFieldContainer[str]
    file_name: str
    ocr_languages: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, object_path: _Optional[str] = ..., title: _Optional[str] = ..., is_organization_wide: _Optional[bool] = ..., department_ids: _Optional[_Iterable[str]] = ..., file_name: _Optional[str] = ..., ocr_languages: _Optional[_Iterable[str]] = ...) -> None: ...

class ReplaceDocumentRequest(_message.Message):
    __slots__ = ("id", "object_path", "ocr_languages")
    ID_FIELD_NUMBER: _ClassVar[int]
    OBJECT_PATH_FIELD_NUMBER: _ClassVar[int]
    OCR_LANGUAGES_FIELD_NUMBER: _ClassVar[int]
    id: str
    object_path: str
    ocr_languages: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, id: _Optional[str] = ..., object_path: _Optional[str] = ..., ocr_languages: _Optional[_Iterable[str]] = ...) -> None: ...

class ListDocumentsRequest(_message.Message):
    __slots__ = ("page", "status", "department_id", "file_type", "include_deleted")
    PAGE_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    DEPARTMENT_ID_FIELD_NUMBER: _ClassVar[int]
    FILE_TYPE_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_DELETED_FIELD_NUMBER: _ClassVar[int]
    page: _common_pb2.PageRequest
    status: DocumentStatus
    department_id: str
    file_type: DocumentFileType
    include_deleted: bool
    def __init__(self, page: _Optional[_Union[_common_pb2.PageRequest, _Mapping]] = ..., status: _Optional[_Union[DocumentStatus, str]] = ..., department_id: _Optional[str] = ..., file_type: _Optional[_Union[DocumentFileType, str]] = ..., include_deleted: _Optional[bool] = ...) -> None: ...

class ListDocumentsResponse(_message.Message):
    __slots__ = ("items", "meta")
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    META_FIELD_NUMBER: _ClassVar[int]
    items: _containers.RepeatedCompositeFieldContainer[DocumentResponse]
    meta: _common_pb2.PageMeta
    def __init__(self, items: _Optional[_Iterable[_Union[DocumentResponse, _Mapping]]] = ..., meta: _Optional[_Union[_common_pb2.PageMeta, _Mapping]] = ...) -> None: ...

class DocumentIdRequest(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class UpdateDocumentRequest(_message.Message):
    __slots__ = ("id", "title", "is_organization_wide")
    ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    IS_ORGANIZATION_WIDE_FIELD_NUMBER: _ClassVar[int]
    id: str
    title: str
    is_organization_wide: bool
    def __init__(self, id: _Optional[str] = ..., title: _Optional[str] = ..., is_organization_wide: _Optional[bool] = ...) -> None: ...

class SetDocumentDepartmentsRequest(_message.Message):
    __slots__ = ("id", "department_ids")
    ID_FIELD_NUMBER: _ClassVar[int]
    DEPARTMENT_IDS_FIELD_NUMBER: _ClassVar[int]
    id: str
    department_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, id: _Optional[str] = ..., department_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class ListDocumentDepartmentsResponse(_message.Message):
    __slots__ = ("department_ids",)
    DEPARTMENT_IDS_FIELD_NUMBER: _ClassVar[int]
    department_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, department_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class DeleteDocumentResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class DownloadDocumentResponse(_message.Message):
    __slots__ = ("download_url", "expires_at")
    DOWNLOAD_URL_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    download_url: str
    expires_at: _timestamp_pb2.Timestamp
    def __init__(self, download_url: _Optional[str] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class DocumentChunkResponse(_message.Message):
    __slots__ = ("id", "document_id", "chunk_index", "content_text", "page_number", "token_count", "vector_point_id", "created_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    CHUNK_INDEX_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TEXT_FIELD_NUMBER: _ClassVar[int]
    PAGE_NUMBER_FIELD_NUMBER: _ClassVar[int]
    TOKEN_COUNT_FIELD_NUMBER: _ClassVar[int]
    VECTOR_POINT_ID_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    document_id: str
    chunk_index: int
    content_text: str
    page_number: int
    token_count: int
    vector_point_id: str
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., document_id: _Optional[str] = ..., chunk_index: _Optional[int] = ..., content_text: _Optional[str] = ..., page_number: _Optional[int] = ..., token_count: _Optional[int] = ..., vector_point_id: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ListDocumentChunksRequest(_message.Message):
    __slots__ = ("document_id", "page")
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    document_id: str
    page: _common_pb2.PageRequest
    def __init__(self, document_id: _Optional[str] = ..., page: _Optional[_Union[_common_pb2.PageRequest, _Mapping]] = ...) -> None: ...

class ListDocumentChunksResponse(_message.Message):
    __slots__ = ("items", "meta")
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    META_FIELD_NUMBER: _ClassVar[int]
    items: _containers.RepeatedCompositeFieldContainer[DocumentChunkResponse]
    meta: _common_pb2.PageMeta
    def __init__(self, items: _Optional[_Iterable[_Union[DocumentChunkResponse, _Mapping]]] = ..., meta: _Optional[_Union[_common_pb2.PageMeta, _Mapping]] = ...) -> None: ...

class GetDocumentChunkRequest(_message.Message):
    __slots__ = ("document_id", "chunk_id")
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    CHUNK_ID_FIELD_NUMBER: _ClassVar[int]
    document_id: str
    chunk_id: str
    def __init__(self, document_id: _Optional[str] = ..., chunk_id: _Optional[str] = ...) -> None: ...

class DocumentFlagResponse(_message.Message):
    __slots__ = ("id", "document_id", "document_title", "flag_type", "severity", "detail", "confidence_score", "detected_at", "resolved_at", "resolved_by_id", "resolution", "resolution_comment", "related_document_id", "related_chunk_id")
    ID_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_TITLE_FIELD_NUMBER: _ClassVar[int]
    FLAG_TYPE_FIELD_NUMBER: _ClassVar[int]
    SEVERITY_FIELD_NUMBER: _ClassVar[int]
    DETAIL_FIELD_NUMBER: _ClassVar[int]
    CONFIDENCE_SCORE_FIELD_NUMBER: _ClassVar[int]
    DETECTED_AT_FIELD_NUMBER: _ClassVar[int]
    RESOLVED_AT_FIELD_NUMBER: _ClassVar[int]
    RESOLVED_BY_ID_FIELD_NUMBER: _ClassVar[int]
    RESOLUTION_FIELD_NUMBER: _ClassVar[int]
    RESOLUTION_COMMENT_FIELD_NUMBER: _ClassVar[int]
    RELATED_DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    RELATED_CHUNK_ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    document_id: str
    document_title: str
    flag_type: DocumentFlagType
    severity: DocumentFlagSeverity
    detail: str
    confidence_score: float
    detected_at: _timestamp_pb2.Timestamp
    resolved_at: _timestamp_pb2.Timestamp
    resolved_by_id: str
    resolution: DocumentFlagResolution
    resolution_comment: str
    related_document_id: str
    related_chunk_id: str
    def __init__(self, id: _Optional[str] = ..., document_id: _Optional[str] = ..., document_title: _Optional[str] = ..., flag_type: _Optional[_Union[DocumentFlagType, str]] = ..., severity: _Optional[_Union[DocumentFlagSeverity, str]] = ..., detail: _Optional[str] = ..., confidence_score: _Optional[float] = ..., detected_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., resolved_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., resolved_by_id: _Optional[str] = ..., resolution: _Optional[_Union[DocumentFlagResolution, str]] = ..., resolution_comment: _Optional[str] = ..., related_document_id: _Optional[str] = ..., related_chunk_id: _Optional[str] = ...) -> None: ...

class ListDocumentFlagsRequest(_message.Message):
    __slots__ = ("flag_types", "include_resolved", "page", "severity", "document_id")
    FLAG_TYPES_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_RESOLVED_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    SEVERITY_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    flag_types: _containers.RepeatedScalarFieldContainer[DocumentFlagType]
    include_resolved: bool
    page: _common_pb2.PageRequest
    severity: DocumentFlagSeverity
    document_id: str
    def __init__(self, flag_types: _Optional[_Iterable[_Union[DocumentFlagType, str]]] = ..., include_resolved: _Optional[bool] = ..., page: _Optional[_Union[_common_pb2.PageRequest, _Mapping]] = ..., severity: _Optional[_Union[DocumentFlagSeverity, str]] = ..., document_id: _Optional[str] = ...) -> None: ...

class DocumentFlagIdRequest(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class KnowledgeArticleResponse(_message.Message):
    __slots__ = ("id", "title", "updated_at", "chunk_count")
    ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    CHUNK_COUNT_FIELD_NUMBER: _ClassVar[int]
    id: str
    title: str
    updated_at: _timestamp_pb2.Timestamp
    chunk_count: int
    def __init__(self, id: _Optional[str] = ..., title: _Optional[str] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., chunk_count: _Optional[int] = ...) -> None: ...

class ListKnowledgeArticlesRequest(_message.Message):
    __slots__ = ("page",)
    PAGE_FIELD_NUMBER: _ClassVar[int]
    page: _common_pb2.PageRequest
    def __init__(self, page: _Optional[_Union[_common_pb2.PageRequest, _Mapping]] = ...) -> None: ...

class ListKnowledgeArticlesResponse(_message.Message):
    __slots__ = ("items", "meta")
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    META_FIELD_NUMBER: _ClassVar[int]
    items: _containers.RepeatedCompositeFieldContainer[KnowledgeArticleResponse]
    meta: _common_pb2.PageMeta
    def __init__(self, items: _Optional[_Iterable[_Union[KnowledgeArticleResponse, _Mapping]]] = ..., meta: _Optional[_Union[_common_pb2.PageMeta, _Mapping]] = ...) -> None: ...

class KnowledgeArticleBlockResponse(_message.Message):
    __slots__ = ("chunk_index", "page_number", "content_text")
    CHUNK_INDEX_FIELD_NUMBER: _ClassVar[int]
    PAGE_NUMBER_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TEXT_FIELD_NUMBER: _ClassVar[int]
    chunk_index: int
    page_number: int
    content_text: str
    def __init__(self, chunk_index: _Optional[int] = ..., page_number: _Optional[int] = ..., content_text: _Optional[str] = ...) -> None: ...

class GetKnowledgeArticleRequest(_message.Message):
    __slots__ = ("id", "page")
    ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    id: str
    page: _common_pb2.PageRequest
    def __init__(self, id: _Optional[str] = ..., page: _Optional[_Union[_common_pb2.PageRequest, _Mapping]] = ...) -> None: ...

class KnowledgeArticleDetailResponse(_message.Message):
    __slots__ = ("article", "blocks", "meta", "has_unindexed_pages")
    ARTICLE_FIELD_NUMBER: _ClassVar[int]
    BLOCKS_FIELD_NUMBER: _ClassVar[int]
    META_FIELD_NUMBER: _ClassVar[int]
    HAS_UNINDEXED_PAGES_FIELD_NUMBER: _ClassVar[int]
    article: KnowledgeArticleResponse
    blocks: _containers.RepeatedCompositeFieldContainer[KnowledgeArticleBlockResponse]
    meta: _common_pb2.PageMeta
    has_unindexed_pages: bool
    def __init__(self, article: _Optional[_Union[KnowledgeArticleResponse, _Mapping]] = ..., blocks: _Optional[_Iterable[_Union[KnowledgeArticleBlockResponse, _Mapping]]] = ..., meta: _Optional[_Union[_common_pb2.PageMeta, _Mapping]] = ..., has_unindexed_pages: _Optional[bool] = ...) -> None: ...

class ResolveDocumentFlagRequest(_message.Message):
    __slots__ = ("id", "resolution", "comment")
    ID_FIELD_NUMBER: _ClassVar[int]
    RESOLUTION_FIELD_NUMBER: _ClassVar[int]
    COMMENT_FIELD_NUMBER: _ClassVar[int]
    id: str
    resolution: DocumentFlagResolution
    comment: str
    def __init__(self, id: _Optional[str] = ..., resolution: _Optional[_Union[DocumentFlagResolution, str]] = ..., comment: _Optional[str] = ...) -> None: ...

class DeleteDocumentFlagResponse(_message.Message):
    __slots__ = ("deleted",)
    DELETED_FIELD_NUMBER: _ClassVar[int]
    deleted: bool
    def __init__(self, deleted: _Optional[bool] = ...) -> None: ...

class ListDocumentFlagsResponse(_message.Message):
    __slots__ = ("items", "meta")
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    META_FIELD_NUMBER: _ClassVar[int]
    items: _containers.RepeatedCompositeFieldContainer[DocumentFlagResponse]
    meta: _common_pb2.PageMeta
    def __init__(self, items: _Optional[_Iterable[_Union[DocumentFlagResponse, _Mapping]]] = ..., meta: _Optional[_Union[_common_pb2.PageMeta, _Mapping]] = ...) -> None: ...

class StorageUsageResponse(_message.Message):
    __slots__ = ("used_bytes", "limit_bytes", "document_count")
    USED_BYTES_FIELD_NUMBER: _ClassVar[int]
    LIMIT_BYTES_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_COUNT_FIELD_NUMBER: _ClassVar[int]
    used_bytes: int
    limit_bytes: int
    document_count: int
    def __init__(self, used_bytes: _Optional[int] = ..., limit_bytes: _Optional[int] = ..., document_count: _Optional[int] = ...) -> None: ...

class ListDocumentsByIdsRequest(_message.Message):
    __slots__ = ("document_ids",)
    DOCUMENT_IDS_FIELD_NUMBER: _ClassVar[int]
    document_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, document_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class ListDocumentsByIdsResponse(_message.Message):
    __slots__ = ("items",)
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    items: _containers.RepeatedCompositeFieldContainer[DocumentResponse]
    def __init__(self, items: _Optional[_Iterable[_Union[DocumentResponse, _Mapping]]] = ...) -> None: ...

class ListDocumentChunksByIdsRequest(_message.Message):
    __slots__ = ("chunk_ids",)
    CHUNK_IDS_FIELD_NUMBER: _ClassVar[int]
    chunk_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, chunk_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class DocumentChunkSummary(_message.Message):
    __slots__ = ("chunk_id", "document_id", "document_title", "page_number", "chunk_index", "content_text")
    CHUNK_ID_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_TITLE_FIELD_NUMBER: _ClassVar[int]
    PAGE_NUMBER_FIELD_NUMBER: _ClassVar[int]
    CHUNK_INDEX_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TEXT_FIELD_NUMBER: _ClassVar[int]
    chunk_id: str
    document_id: str
    document_title: str
    page_number: int
    chunk_index: int
    content_text: str
    def __init__(self, chunk_id: _Optional[str] = ..., document_id: _Optional[str] = ..., document_title: _Optional[str] = ..., page_number: _Optional[int] = ..., chunk_index: _Optional[int] = ..., content_text: _Optional[str] = ...) -> None: ...

class ListDocumentChunksByIdsResponse(_message.Message):
    __slots__ = ("items",)
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    items: _containers.RepeatedCompositeFieldContainer[DocumentChunkSummary]
    def __init__(self, items: _Optional[_Iterable[_Union[DocumentChunkSummary, _Mapping]]] = ...) -> None: ...

class IngestionJobResponse(_message.Message):
    __slots__ = ("id", "document_id", "bullmq_job_id", "status", "error_log", "processed_at", "created_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    BULLMQ_JOB_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    ERROR_LOG_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    document_id: str
    bullmq_job_id: str
    status: IngestionJobStatus
    error_log: str
    processed_at: _timestamp_pb2.Timestamp
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., document_id: _Optional[str] = ..., bullmq_job_id: _Optional[str] = ..., status: _Optional[_Union[IngestionJobStatus, str]] = ..., error_log: _Optional[str] = ..., processed_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ListIngestionJobsRequest(_message.Message):
    __slots__ = ("page", "status", "document_id")
    PAGE_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    page: _common_pb2.PageRequest
    status: IngestionJobStatus
    document_id: str
    def __init__(self, page: _Optional[_Union[_common_pb2.PageRequest, _Mapping]] = ..., status: _Optional[_Union[IngestionJobStatus, str]] = ..., document_id: _Optional[str] = ...) -> None: ...

class ListIngestionJobsResponse(_message.Message):
    __slots__ = ("items", "meta")
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    META_FIELD_NUMBER: _ClassVar[int]
    items: _containers.RepeatedCompositeFieldContainer[IngestionJobResponse]
    meta: _common_pb2.PageMeta
    def __init__(self, items: _Optional[_Iterable[_Union[IngestionJobResponse, _Mapping]]] = ..., meta: _Optional[_Union[_common_pb2.PageMeta, _Mapping]] = ...) -> None: ...

class IngestionJobIdRequest(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class CancelIngestionJobResponse(_message.Message):
    __slots__ = ("cancelled",)
    CANCELLED_FIELD_NUMBER: _ClassVar[int]
    cancelled: bool
    def __init__(self, cancelled: _Optional[bool] = ...) -> None: ...
