import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { MAX_DEVICE_NAME_LENGTH } from '../../../../common/config/dto.config';

export class LoginDto {
  @IsEmail()
  readonly email!: string;

  @IsNotEmpty()
  @IsString()
  readonly password!: string;

  /**
   * Display label for the "your active sessions" screen ("Chrome on macOS").
   *
   * Its destination is `device_sessions.device_name`, written when the session
   * row is created — which is why it looks unused in `login()`. Being
   * client-supplied, it must never influence a security decision: device trust
   * is proven with the separate `deviceToken` cookie, a secret the server
   * issued.
   *
   * `@MaxLength(100)` mirrors `device_sessions.device_name VarChar(100)`;
   * without it an oversized value is a Postgres error on insert rather than a
   * 400 at the edge.
   *
   * Optional rather than nullable: absent means "the client did not label this
   * device", which is what the proto's `optional string` expects.
   *
   * **There is deliberately no `ipAddress` field.** A body field is whatever
   * the client says it is, so accepting one would let an attacker post
   * `{"ipAddress": "10.0.0.1"}` to poison the audit trail and evade IP-based
   * lockout. The gateway derives it from the transport.
   */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DEVICE_NAME_LENGTH)
  readonly deviceName?: string;
}

/**
 * Second leg of a multi-tenant login.
 *
 * `organizationId` is accepted from the body here, which looks like it breaks
 * the "never trust the client for tenancy" rule — it does not. auth-service
 * only honours it when it appears in the tenant-selection token's verified set,
 * so it selects among already-proven options rather than asserting one.
 */
export class LoginWithTenantDto {
  @IsUUID()
  readonly organizationId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_DEVICE_NAME_LENGTH)
  readonly deviceName?: string;
}
