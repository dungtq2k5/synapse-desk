import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Gender(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    GENDER_UNSPECIFIED: _ClassVar[Gender]
    GENDER_MALE: _ClassVar[Gender]
    GENDER_FEMALE: _ClassVar[Gender]
    GENDER_OTHER: _ClassVar[Gender]

class OrgStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ORG_STATUS_UNSPECIFIED: _ClassVar[OrgStatus]
    ORG_STATUS_PENDING_ONBOARDING: _ClassVar[OrgStatus]
    ORG_STATUS_ACTIVE: _ClassVar[OrgStatus]
    ORG_STATUS_SUSPENDED_PAST_DUE: _ClassVar[OrgStatus]
    ORG_STATUS_FROZEN: _ClassVar[OrgStatus]

class AiModelTier(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    AI_MODEL_TIER_UNSPECIFIED: _ClassVar[AiModelTier]
    AI_MODEL_TIER_FAST: _ClassVar[AiModelTier]
    AI_MODEL_TIER_QUALITY: _ClassVar[AiModelTier]

class SortOrder(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SORT_ORDER_UNSPECIFIED: _ClassVar[SortOrder]
    SORT_ORDER_ASC: _ClassVar[SortOrder]
    SORT_ORDER_DESC: _ClassVar[SortOrder]
GENDER_UNSPECIFIED: Gender
GENDER_MALE: Gender
GENDER_FEMALE: Gender
GENDER_OTHER: Gender
ORG_STATUS_UNSPECIFIED: OrgStatus
ORG_STATUS_PENDING_ONBOARDING: OrgStatus
ORG_STATUS_ACTIVE: OrgStatus
ORG_STATUS_SUSPENDED_PAST_DUE: OrgStatus
ORG_STATUS_FROZEN: OrgStatus
AI_MODEL_TIER_UNSPECIFIED: AiModelTier
AI_MODEL_TIER_FAST: AiModelTier
AI_MODEL_TIER_QUALITY: AiModelTier
SORT_ORDER_UNSPECIFIED: SortOrder
SORT_ORDER_ASC: SortOrder
SORT_ORDER_DESC: SortOrder

class UserResponse(_message.Message):
    __slots__ = ("id", "organization_id", "full_name", "avatar_url", "email", "is_email_verified", "phone_number", "is_phone_verified", "dob", "gender", "last_login_at", "is_locked", "is_two_factor_enabled", "created_at", "updated_at", "locked_until")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    FULL_NAME_FIELD_NUMBER: _ClassVar[int]
    AVATAR_URL_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    IS_EMAIL_VERIFIED_FIELD_NUMBER: _ClassVar[int]
    PHONE_NUMBER_FIELD_NUMBER: _ClassVar[int]
    IS_PHONE_VERIFIED_FIELD_NUMBER: _ClassVar[int]
    DOB_FIELD_NUMBER: _ClassVar[int]
    GENDER_FIELD_NUMBER: _ClassVar[int]
    LAST_LOGIN_AT_FIELD_NUMBER: _ClassVar[int]
    IS_LOCKED_FIELD_NUMBER: _ClassVar[int]
    IS_TWO_FACTOR_ENABLED_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    LOCKED_UNTIL_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    full_name: str
    avatar_url: str
    email: str
    is_email_verified: bool
    phone_number: str
    is_phone_verified: bool
    dob: str
    gender: Gender
    last_login_at: _timestamp_pb2.Timestamp
    is_locked: bool
    is_two_factor_enabled: bool
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    locked_until: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., full_name: _Optional[str] = ..., avatar_url: _Optional[str] = ..., email: _Optional[str] = ..., is_email_verified: _Optional[bool] = ..., phone_number: _Optional[str] = ..., is_phone_verified: _Optional[bool] = ..., dob: _Optional[str] = ..., gender: _Optional[_Union[Gender, str]] = ..., last_login_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., is_locked: _Optional[bool] = ..., is_two_factor_enabled: _Optional[bool] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., locked_until: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class PageRequest(_message.Message):
    __slots__ = ("page", "limit", "search_term", "sort_by", "sort_order")
    PAGE_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    SEARCH_TERM_FIELD_NUMBER: _ClassVar[int]
    SORT_BY_FIELD_NUMBER: _ClassVar[int]
    SORT_ORDER_FIELD_NUMBER: _ClassVar[int]
    page: int
    limit: int
    search_term: str
    sort_by: str
    sort_order: SortOrder
    def __init__(self, page: _Optional[int] = ..., limit: _Optional[int] = ..., search_term: _Optional[str] = ..., sort_by: _Optional[str] = ..., sort_order: _Optional[_Union[SortOrder, str]] = ...) -> None: ...

class PageMeta(_message.Message):
    __slots__ = ("total_items", "item_count", "items_per_page", "total_pages", "current_page")
    TOTAL_ITEMS_FIELD_NUMBER: _ClassVar[int]
    ITEM_COUNT_FIELD_NUMBER: _ClassVar[int]
    ITEMS_PER_PAGE_FIELD_NUMBER: _ClassVar[int]
    TOTAL_PAGES_FIELD_NUMBER: _ClassVar[int]
    CURRENT_PAGE_FIELD_NUMBER: _ClassVar[int]
    total_items: int
    item_count: int
    items_per_page: int
    total_pages: int
    current_page: int
    def __init__(self, total_items: _Optional[int] = ..., item_count: _Optional[int] = ..., items_per_page: _Optional[int] = ..., total_pages: _Optional[int] = ..., current_page: _Optional[int] = ...) -> None: ...
