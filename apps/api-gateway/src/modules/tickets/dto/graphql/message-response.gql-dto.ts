import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { AnswerStatus } from '@synapsedesk/common';

/**
 * One message in a ticket thread, as the GraphQL schema serves it.
 *
 * **`isInternalNote` is filtered by ticket-service, not here**, and
 * this is the THIRD transport to face that boundary after the REST `WHERE`
 * clause and the WebSocket fan-out. Three
 * transports, one rule: it belongs in the service, and a GraphQL-side filter
 * would be a fourth implementation of it.
 *
 * **No `attachments`, deliberately** — recorded as REST-only in the contract
 * spec rather than left implicit. The URLs are internal object paths resolved
 * per request, so the schema does not carry them.
 */
@ObjectType('TicketMessage')
export class TicketMessageResponseGqlDto {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  ticketId!: string;

  /**
   * Null for an AI-generated message — no user wrote it, and naming one would
   * put words in a real person's mouth in a permanent record.
   */
  @Field(() => ID, { nullable: true })
  senderId!: string | null;

  @Field(() => String)
  content!: string;

  @Field(() => Boolean)
  isAiGenerated!: boolean;

  @Field(() => Boolean)
  isInternalNote!: boolean;

  // Free-form on purpose -- the provider's model id, e.g. `gemini-2.0-flash`.
  // NOT `AiModelTier`, which is the FAST/QUALITY knob a tenant sets; the tier
  // chooses the model, it does not name it.
  @Field(() => String, { nullable: true })
  modelName!: string | null;

  @Field(() => Int, { nullable: true })
  promptTokens!: number | null;

  @Field(() => Int, { nullable: true })
  completionTokens!: number | null;

  @Field(() => Date, { nullable: true })
  editedAt!: Date | null;

  /**
   * Set when a moderator redacted this message.
   *
   * Non-null means `content` is the PLACEHOLDER rather than what was written —
   * a client rendering the placeholder as ordinary text would be misleading, so
   * the flag travels alongside rather than being inferred from the string.
   */
  @Field(() => Date, { nullable: true })
  redactedAt!: Date | null;

  @Field(() => Date)
  createdAt!: Date;

  /**
   * How this AI message was produced — `REFUSED`, `DOC_ANSWER`, `DOC_MISSING`.
   * Null for a human message.
   *
   * **Exposed here as well as on REST**. An agent scrolling a
   * conversation should be able to tell a refusal from an escalation from a
   * real answer, and that is true whichever transport they read it through.
   * Before this it lived only in a WebSocket frame nobody persisted, so the
   * distinction vanished the moment the socket closed.
   */
  // `AnswerStatus`, matching the REST DTO -- this was `string` on the GraphQL
  // side alone, which is the divergence `dto-contract.e2e-spec.ts` exists to
  // catch. Still `@Field(() => String)`: the SDL keeps its scalar shape.
  @Field(() => String, { nullable: true })
  answerStatus!: AnswerStatus | null;
}
