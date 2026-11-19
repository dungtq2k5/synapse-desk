import {
  ActivateTwoFactorResponse,
  AuthenticateTwoFactorResponse,
  BackupCodesStatusResponse,
  fromProtoTimestamp,
  requireField,
} from '@synapsedesk/grpc-proto';
import { toUserResponseDto } from '../users/user.mapper';
import { UserResponseDto } from '../users/dto/rest/user-response.dto';
import {
  BackupCodesStatusResponseDto,
  TwoFactorEnabledResponseDto,
} from './dto/rest/two-factor-response.dto';

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

/**
 * What enabling two-step answered: the body, and the session's tokens when it
 * was enabled through the sign-in challenge. The tokens are set as cookies,
 * never put in the body.
 */
export type TwoFactorEnabledResult = {
  body: TwoFactorEnabledResponseDto;
  session: { accessToken: string; refreshToken: string } | null;
};

/** Splits an `ActivateTwoFactorResponse` into the body and the session. */
export function toTwoFactorEnabledResult(
  response: ActivateTwoFactorResponse,
): TwoFactorEnabledResult {
  const signedIn = !!response.accessToken && !!response.refreshToken;
  return {
    body: {
      backupCodes: response.backupCodes,
      user: signedIn && response.user ? toUserResponseDto(response.user) : null,
    },
    session: signedIn
      ? {
          accessToken: response.accessToken!,
          refreshToken: response.refreshToken!,
        }
      : null,
  };
}

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
