# 0004 — Mapper names carry the foreign type, and the two directions are asymmetric

**Status:** accepted · **Rule:** [development-conventions.md §12.1](../development-conventions.md)

## Decision

`to<ReturnTypeName>` outbound, `from<InputTypeName>` inbound — both naming **the side a reader cannot infer from context**. `require<InputTypeName>` is the third form: a `from*` that throws instead of returning `undefined`.

## Why the prefixes look asymmetric and are not

Both name the unfamiliar type, because the other side is whatever the surrounding file already is:

| Direction | Named side | Example | Reads as |
| :---- | :---- | :---- | :---- |
| `to*` | Where the value is **going** | `toProtoGender(gender: string)` | "domain → proto" |
| `from*` | Where the value **came from** | `fromProtoGender(g: ProtoGender)` | "proto → domain" |
| `to*` | | `toTicketResponseDto(t: TicketResponse)` | "wire → REST DTO" |
| `to*` | | `toUserSummaryGqlDto(u: UserSummary)` | "wire → GraphQL DTO" |

So `toProtoGender` and `fromProtoGender` both name *Proto*, and `toTicketResponseDto` names the DTO — in every case the unfamiliar type, never the ambient one. **`toUser` is the version this rule exists to prevent**: it returns one of three user shapes and the call site cannot tell which.

## The pair is the unit

`toProtoGender` / `fromProtoGender` exist together because `Gender` names two types that are not interchangeable — a domain string and a proto number. Where a pair exists, going around it is how the two get confused.

## Why the directions behave differently

- **`to*` is the response path and must not throw.** A row carrying a value nobody recognises maps to `UNSPECIFIED`, so an unknown enum surfaces as "unset" rather than failing a read the caller is entitled to.
- **`from*` returns `null` for `UNSPECIFIED`** and lets the caller decide how to complain — it knows its own transport, and proto3's zero value means *"the field was not set"*, which no domain value can honestly stand in for.

## One documented exception

`toIsoDate(date: Date): string` is named for its *format*, not its return type — `toString` would be meaningless and would collide with the builtin. **When the return type's name carries no information, name the thing that does.**
