import {
  AuthenticateTwoFactorResponse,
  BackupCodesStatusResponse,
  fromProtoTimestamp,
  requireField,
} from '@synapsedesk/grpc-proto';
import { toUserResponseDto } from '../users/user.mapper';
import { UserResponseDto } from '../users/dto/rest/user-response.dto';
import { BackupCodesStatusResponseDto } from './dto/rest/two-factor-response.dto';

/**
 * Everything the controller needs to set cookies and shape the body.
 *
 * Not a `*Dto`: `accessToken`, `refreshToken` and `deviceToken` are set as
 * cookies and must never reach a REST body. The response DTO is
 * `TwoFactorAuthenticatedResponseDto`, which carries only `user` and `warning`.
 */
export type TwoFactorAuthenticateResult = {
  user: UserResponseDto;
  accessToken: string;
  refreshToken: string;
  deviceToken: string | null;
  warning: string | null;
};

/** Converts a `BackupCodesStatusResponse` off the wire into its REST DTO. */
export function toBackupCodesStatusResponseDto(
  response: BackupCodesStatusResponse,
): BackupCodesStatusResponseDto {
  return {
    remaining: response.remaining,
    used: response.used,
    expiresAt: fromProtoTimestamp(response.expiresAt) ?? null,
  };
}

/**
 * Splits an `AuthenticateTwoFactorResponse` into the user shape and the tokens.
 *
 * @throws Error if the response carries no user, which the proto requires.
 */
export function toTwoFactorAuthenticateResult(
  response: AuthenticateTwoFactorResponse,
): TwoFactorAuthenticateResult {
  return {
    user: toUserResponseDto(requireField(response.user, 'user')),
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    deviceToken: response.deviceToken ?? null,
    warning: response.warning ?? null,
  };
}
