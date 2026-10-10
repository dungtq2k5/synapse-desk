import { requireField } from '@synapsedesk/grpc-proto';
import type { CreateMessageRequest } from '@synapsedesk/grpc-proto';
import type { CallerContext } from '@synapsedesk/common';
import type { MessagesService } from '../../src/modules/messages/messages.service';

/**
 * `createMessage`, with the attachment fields supplied and its wrapper unwrapped.
 *
 * The RPC takes `attachments` and answers with `{ message, skippedAttachments }`
 * because a create can partially succeed: a file whose confirm failed is named
 * and the message is written anyway. Most tests predate that and assert
 * on the message alone, so this supplies the empty list and hands back the
 * message — leaving the wrapper to the tests that are actually about it.
 *
 * **Here rather than copied into each spec.** It was, in four of them, which is
 * four places to edit the next time the signature moves and three chances to
 * miss one.
 *
 * **Not named `postMessage`.** That is a DOM/worker global with a `(message,
 * targetOrigin: string)` signature, so a spec that failed to import this
 * resolved to it instead — and the error surfaced as "argument of type {...} is
 * not assignable to parameter of type 'string'", which points nowhere near the
 * missing import.
 */
export async function createTestMessage(
  messages: MessagesService,
  request: Omit<CreateMessageRequest, 'attachments'>,
  context: CallerContext,
) {
  const response = await messages.createMessage(
    { ...request, attachments: [] },
    context,
  );

  return requireField(response.message, 'message');
}
