import { Type } from 'class-transformer';
import { UserBase } from '../base/user.base';
import { IsArray, IsIn, IsUUID, ValidateNested } from 'class-validator';
import { PERMISSION_CODES, PermissionCode } from '@synapsedesk/common';

export class UserResponseDto extends UserBase {}

export class CurrentUserResponseDto {
  @Type(() => UserResponseDto)
  @ValidateNested()
  readonly user!: UserResponseDto;

  /**
   * `@IsIn`, not `@IsEnum`. `IsEnum` expects an enum object and works on a
   * readonly array only by accident, via `Object.values`. `IsIn` is the
   * decorator that actually means "one of these values".
   *
   * Note these run on the way IN, not out — `ValidationPipe` validates request
   * payloads, so on a response DTO they are documentation and Swagger metadata.
   * The real narrowing of `string[]` (what the proto declares) to
   * `PermissionCode[]` happens in the gRPC client.
   */
  @IsArray()
  @IsIn(PERMISSION_CODES, { each: true })
  readonly permissionCodes!: PermissionCode[];

  @IsArray()
  @IsUUID('all', { each: true })
  readonly departmentIds!: string[];
}
