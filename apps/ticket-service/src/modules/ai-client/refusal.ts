import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { readHttpStatusHint } from '@synapsedesk/common';

/**
 * The HTTP status rag-service marks a refused draft with — its `DRAFT_REFUSAL`.
 *
 * Matched rather than assumed from the gRPC code alone: `FAILED_PRECONDITION`
 * is a general "this request cannot proceed", and one day something else on
 * this path will use it. The marker is what says *refused as injection*.
 */
const REFUSAL_HTTP_STATUS = 422;

/**
 * Whether a failed draft was REFUSED, as opposed to merely failing
 *
 * **The distinction decides whether a message is excluded from AI context**, so
 * being wrong in either direction has a cost. Treating an outage as a refusal
 * would shrink a thread's context every time the provider had a bad minute;
 * treating a refusal as an outage leaves the refused question in the transcript
 * and the guard refuses the same thing on every retry.
 *
 * Reads the shape rather than instance-checking, because a gRPC error crosses
 * the wire as a plain object — the same reason `RagClientService.call` reads
 * `code` instead of using `instanceof`.
 */
export function isDraftRefusal(error: unknown): boolean {
  const { code, details, message } = asGrpcError(error);
  if (code !== status.FAILED_PRECONDITION) return false;

  return (
    readHttpStatusHint(details ?? message ?? '').httpStatus ===
    REFUSAL_HTTP_STATUS
  );
}

function asGrpcError(error: unknown): {
  code?: number;
  details?: string;
  message?: string;
} {
  if (error instanceof RpcException) {
    const inner = error.getError();

    return typeof inner === 'string' ? { message: inner } : inner;
  }

  return error ?? {};
}
