/** @file What the avatar routes return. */

export class PresignAvatarResponseDto {
  uploadUrl!: string;
  objectPath!: string;
  expiresAt!: Date;
}
