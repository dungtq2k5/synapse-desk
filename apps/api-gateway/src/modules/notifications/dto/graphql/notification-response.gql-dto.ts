import { Field, ID, ObjectType } from '@nestjs/graphql';

/**
 * One row of the in-app feed, as the GraphQL schema serves it.
 *
 * **`data`, `groupKey` and `groupCount` are absent**, recorded as REST-only in
 * the contract spec:
 *
 *   - `data` is an untyped bag whose shape varies by notification type. GraphQL
 *     has no honest type for it short of a JSON scalar, and a JSON scalar in a
 *     schema is a hole where the contract should be.
 *   - `groupKey` is Domain E's internal coalescing key and means nothing to a
 *     client.
 */
@ObjectType('Notification')
export class NotificationResponseGqlDto {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  organizationId!: string;

  /** The ORIGINATING event — `ticket.assigned`, never the NATS subject. */
  @Field(() => String)
  type!: string;

  @Field(() => String)
  priority!: string;

  @Field(() => String)
  title!: string;

  @Field(() => String, { nullable: true })
  body!: string | null;

  @Field(() => String, { nullable: true })
  actionUrl!: string | null;

  /** Who caused it. Flat beside the `actor` edge — same rule as everywhere. */
  @Field(() => ID, { nullable: true })
  actorId!: string | null;

  @Field(() => String, { nullable: true })
  resourceType!: string | null;

  @Field(() => ID, { nullable: true })
  resourceId!: string | null;

  @Field(() => Date, { nullable: true })
  readAt!: Date | null;

  @Field(() => Date, { nullable: true })
  archivedAt!: Date | null;

  @Field(() => Date)
  createdAt!: Date;
}
