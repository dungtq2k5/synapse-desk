"""The verified caller, as it arrives from the gateway.

The Python mirror of `CallerContext` in `libs/common`. Same fields, same
meanings, and the same rule: **nothing here is asserted by the client.** The
gateway verifies the JWT and packs these into gRPC metadata; this service reads
them and never re-derives or trusts a body field in their place.

`department_ids` in particular is not a convenience — it is half of the
retrieval boundary (RDM §1.2), so a request that could supply its own would be
able to read another department's documents by asking nicely.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class CallerContext:
    """Frozen because a filter built from a mutated context is a filter built
    from something other than what the gateway verified."""

    organization_id: str | None
    """None for a platform Super Admin, who belongs to no tenant."""

    sub: str | None
    """The user id. None for system-initiated work."""

    department_ids: list[str] = field(default_factory=list)

    permission_codes: list[str] = field(default_factory=list)

    is_super_admin: bool = False


class MissingTenantError(Exception):
    """Raised when a tenant-scoped operation gets a context with no tenant.

    A distinct exception rather than a bare `ValueError` so a caller cannot
    accidentally catch it alongside an ordinary validation failure and carry on
    with no filter — which is the one outcome that must never be recoverable.
    """


def require_tenant(ctx: CallerContext) -> str:
    """The tenant, or an exception. Never a default, never an empty string.

    The TypeScript `requireTenant()` exists for the same reason: an empty-string
    tenant matches nothing in Postgres but is a perfectly good Qdrant payload
    value, so a silent fallback would produce a filter that quietly matches the
    wrong partition rather than failing.
    """
    if not ctx.organization_id:
        raise MissingTenantError(
            "This operation requires a tenant; the caller context carries none."
        )

    return ctx.organization_id
