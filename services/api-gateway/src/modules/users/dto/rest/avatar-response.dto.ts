/** @file What the avatar routes return. */

export class PresignAvatarResponseDto {
  uploadUrl!: string;
  /**
   * How to send the bytes to `uploadUrl`, with the declared `Content-Type`:
   * `PUT` to a signed URL, or `POST` to the local Storage emulator.
   */
  uploadMethod!: 'PUT' | 'POST';
  objectPath!: string;
  expiresAt!: Date;
}
