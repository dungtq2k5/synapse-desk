"""The system caller's metadata, as the TypeScript side packs and reads it."""

from rag_service.common.metadata import system_metadata, unpack_caller_context


def test_names_the_system_and_the_tenant_and_no_user():
    pairs = dict(system_metadata("org-1"))

    assert pairs["is_system"] == "true"
    assert pairs["organization_id"] == "org-1"
    assert pairs["is_super_admin"] == "false"
    assert "user_id" not in pairs


def test_reads_back_as_that_tenant_and_no_user():
    context = unpack_caller_context(system_metadata("org-1"))

    assert context.organization_id == "org-1"
    assert context.sub is None
    assert context.is_super_admin is False
