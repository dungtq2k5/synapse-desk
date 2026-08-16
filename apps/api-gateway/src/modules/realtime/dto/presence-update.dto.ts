import { IsIn } from 'class-validator';
import { PRESENCE_STATES, PresenceState } from '../realtime.config';

/**
 * `presence:update`'s body.
 *
 * One field, and it is still a DTO rather than a bare string check, because a
 * socket frame reaches no `ValidationPipe`: whatever the client sent arrives as
 * `unknown`. `@IsIn` against the same tuple the service is typed on means an
 * unknown state is refused at the boundary rather than written into Redis and
 * fanned to the tenant, where every client would then have to defend itself
 * against a status it has never heard of.
 */
export class PresenceUpdateDto {
  @IsIn(PRESENCE_STATES)
  readonly state!: PresenceState;
}
