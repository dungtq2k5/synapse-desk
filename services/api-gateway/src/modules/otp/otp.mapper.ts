import { fromProtoTimestamp, OtpStatusResponse } from '@synapsedesk/grpc-proto';
import { OtpStatusResponseDto } from '../auth/dto/rest/otp-response.dto';

/** Converts an `OtpStatusResponse` off the wire into its REST DTO. */
export function toOtpStatusResponseDto(
  response: OtpStatusResponse,
): OtpStatusResponseDto {
  return {
    pending: response.pending,
    target: response.target ?? null,
    expiresAt: fromProtoTimestamp(response.expiresAt) ?? null,
    attemptsRemaining: response.attemptsRemaining,
  };
}
