# 0050 — A ticket's opening carries its own files; it never becomes the first message

**Status:** accepted · **Code:** `services/ticket-service/src/modules/tickets/` (`createTicket`), `services/ticket-service/src/modules/ai-attachments/ai-attachment.service.ts`, `services/storage-service/src/common/purpose-registry.ts` (`TICKET_OPENING`)

## Decision

**The files someone attaches while opening a ticket belong to the ticket, not to a message.** A `message_attachments` row has exactly one owner: a message (`message_id`) or a ticket's opening (`ticket_id`), enforced by `message_attachments_one_owner_check`. The description stays the opening text; nothing writes it as a message.

**They are uploaded before the ticket exists, under their uploader:** the `TICKET_OPENING` storage purpose (`organizations/{org}/ticket-openings/{uploader}/pending/{uuid}`, moved out on confirm), presigned by `POST /tickets/attachments/upload-url`. `CreateTicket` confirms them before its insert and writes them with the ticket, so no instant has the ticket without its files. The web forms (New ticket, Ask) and an emailed opening all take this path.

**The AI reads them where the opening is the question:** the unary reply (so the first answer) and `Draft` fall back to the opening's files when the thread has no user message left; `Classify` routes on them when there are any.

## Why

- **The first message would have said the question twice.** Every AI transcript already leads with the description as the first user turn, so a message 1 holding the same text would either repeat it or make every transcript learn when to drop the description. It would also publish `message.created` beside `ticket.created` (two notifications for one question), show the text twice in the thread, and break `AnswerOpening`'s "no message yet" precondition.
- **Lost alternative: the opening text becomes message 1** with its files bound. It needed no table change, and everything above in exchange.
- **Lost alternative: create the ticket, then upload into its path.** The ticket would exist without its files while they upload, and a failure in between leaves it that way.
- **Lost alternative: move the files under the ticket's path at confirm.** Confirm would take a destination owner for one purpose and become a rename API. Nothing parses an object path or deletes by prefix, so where an opening file lives costs only the bucket's readability.

## Consequences

- **Every attachment reader handles both owners.** Download and delete reach the ticket through either; every ticket response carries the opening's files as `attachments` (lists included: a read signs nothing, so it costs one `include`); an attachment says `ticketId` or `messageId`.
- **A refused opening is excluded by a flag on the ticket** (`opening_excluded_from_ai_context`), since there is no message to mark ([ADR 0030](./0030-refused-turns-exclude-their-attachments.md)).
- **Only the uploader can bind an upload, and only for the purposes the binder names** ([ADR 0024](./0024-one-upload-mechanism.md)): a path presigned by someone else, or for an avatar or a document, is skipped by name.
- **An unbound opening upload stays under `pending/`,** impossible to confirm once its record expires, like every other abandoned upload (known gap 35).
- **The table keeps its name,** `message_attachments`, though some of its rows have no message.
