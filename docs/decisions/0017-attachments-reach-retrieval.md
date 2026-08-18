# 0017 — An attachment must reach retrieval, not only generation

**Status:** accepted · **Code:** `apps/rag-service/`, `ticket_messages`

## Decision

Attachments participate in reformulation and retrieval, not just as generation context.

## Why

- **"Context only" produces nothing at all.** A question whose content lives entirely in a screenshot retrieves nothing, so generation is handed an empty pool.
- **For search terms, a model beats OCR.** Ask a model *"what is the error here?"* and you get the error. Comprehension is the whole job; OCR is the wrong tool rather than merely an expensive one.

## Consequences

- **The upload flow is message-first** — presign and confirm both require a `message_id` — so on the *first* turn the attachment row does not exist yet when `invoke_ai` fires. Follow-up turns and the co-pilot draft are unaffected.
- Reformulation runs when attachments are present even with no history: the first message is exactly when someone pastes a screenshot and types "how do I fix this?".
- **History attachments are not re-sent** for reformulation — the prior answer already carries their content.
- **`Draft` is the highest-trust position an untrusted file reaches.** After inbound email, the last message on a ticket can come from outside the organisation, so its attachment was chosen by someone who never authenticated.
- **The size ceiling is asymmetric and that is the trap.** The binding constraint is `rag-service`'s gRPC server, not the TS client. A client configured for 10 MB against a server accepting 4 MB fails at the server with `RESOURCE_EXHAUSTED` on a request the client had every reason to think was fine — raise the Python server's options to match, or cap the clients.
