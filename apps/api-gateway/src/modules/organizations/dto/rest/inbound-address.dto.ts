import { ApiProperty } from '@nestjs/swagger';

/**
 * The tenant's inbound support address — 31-doc §2.
 *
 * **The address, not the token.** The token alone is unusable without the mail
 * domain, which is deployment configuration; returning the two separately would
 * make a client the third place the address format is spelled, after
 * `buildInboundAddress` and the outbound `Reply-To`.
 *
 * **Not a secret, and the response says so.** Customers email it, so it is as
 * public as any support address — what it buys is that tenants cannot be
 * enumerated and an abused address can be rotated.
 */
export class InboundAddressResponseDto {
  @ApiProperty({
    example: 'support+a1b2c3d4e5f60718293a4b5c6d7e8f90@inbound.example.com',
    description:
      'Publish this as the tenant’s support address. Rotating it issues a ' +
      'new one and stops the previous address routing immediately.',
  })
  readonly inboundAddress!: string;
}
