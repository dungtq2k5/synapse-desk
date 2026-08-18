import {
  InvalidateCache,
  entityFromCaller,
} from '../../common/decorators/invalidate-cache.decorator';
import { CACHE_SCOPES } from '../../common/config/cache.config';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { OrgAccess, RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { UsersService } from './users.service';
import {
  CurrentUserResponseDto,
  UserResponseDto,
} from './dto/rest/user-response.dto';
import { UpdateOwnProfileDto } from './dto/rest/update-user.dto';
import { ConfirmAvatarDto, PresignAvatarDto } from './dto/rest/avatar.dto';
import { PresignAvatarResponseDto } from './dto/rest/avatar-response.dto';
import { OrgAccessKind } from '../../common/decorators/org-access.decorator';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
} from '../../common/decorators/api-response.decorator';

/**
 * The caller's OWN profile.
 *
 * Separate from the administrative surface in `UserAdminController` because the
 * authorization models differ entirely: everything here is authorized by being
 * the subject, and nothing here needs a permission.
 *
 * Declared BEFORE UserAdminController in the module, so `/users/me` is matched
 * ahead of `/users/:id` — otherwise `me` is swallowed as an id and
 * `ParseUUIDPipe` turns a valid request into a confusing 400.
 */
@ApiTags('Users')
@ApiCookieAuth(AUTH_SCHEMES.access)
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly users: UsersService,
  ) {}

  // The whole `RequestContext`, not just `sub`: it extends `RequestOrigin`, so
  // `ip` and `userAgent` come with it and need no separate derivation.
  @OrgAccessKind(OrgAccess.AUTH)
  @ApiOperation({
    summary: 'Own profile + org + departments + effective permission codes',
  })
  @ApiWrappedResponse(CurrentUserResponseDto)
  @ApiFilterErrors(['401'])
  @Get('me')
  getCurrentUser(
    @CurrentUser() context: RequestContext,
  ): Promise<CurrentUserResponseDto> {
    return this.usersService.getCurrentUser(context.sub, context);
  }

  // Keeping `UpdateOwnProfileDto` narrow is a SECURITY control, not a style
  // choice: `forbidNonWhitelisted` 400s any other key. `avatarUrl` is written
  // only by the avatar-confirm route; `email`/`phoneNumber` only via OTP.
  @ApiOperation({
    summary: 'Update own profile fields (fullName, dob, gender)',
  })
  @ApiWrappedResponse(UserResponseDto)
  @ApiFilterErrors(['400', '401'])
  @InvalidateCache(CACHE_SCOPES.users, entityFromCaller('user'))
  @Patch('me')
  @ResponseMessage('Profile updated')
  updateOwnProfile(
    @CurrentUser() context: RequestContext,
    @Body() updateOwnProfileDto: UpdateOwnProfileDto,
  ): Promise<UserResponseDto> {
    return this.users.updateOwnProfile(updateOwnProfileDto, context);
  }

  // ---------------------------------------------------------------- avatars

  /**
   * Step 1 of presign → upload → confirm.
   *
   * Returns a URL the CLIENT PUTs the bytes to directly, bypassing every
   * application server. That is the whole point of the design: a 2 MB image
   * never occupies a gateway request buffer, and the upload's throughput is
   * Google's problem rather than ours.
   *
   * No permission — this is the caller's own face.
   */
  @ApiOperation({
    summary:
      'Presign a direct-to-Firebase-Storage upload: { contentType, sizeBytes } → { uploadUrl, objectPath, expiresAt }',
  })
  @ApiWrappedResponse(PresignAvatarResponseDto)
  @ApiFilterErrors(['400', '401'])
  @Post('me/avatar/upload-url')
  @HttpCode(HttpStatus.OK)
  presignAvatar(
    @CurrentUser() context: RequestContext,
    @Body() dto: PresignAvatarDto,
  ): Promise<PresignAvatarResponseDto> {
    return this.users.presignAvatar(dto, context);
  }

  /**
   * Step 5–7: the client says it uploaded; auth-service verifies with
   * storage-service, commits the path, audits, and emits the supersede for the
   * OLD object.
   */
  @ApiOperation({
    summary:
      '{ objectPath } — confirms the upload landed, writes users.avatar_url (an object path, not a URL — RDM Table 3), audits, and emits the async delete of the previous avatar if one existed',
  })
  @ApiWrappedResponse(UserResponseDto)
  @ApiFilterErrors(['400', '401'])
  @InvalidateCache(CACHE_SCOPES.users, entityFromCaller('user'))
  @Post('me/avatar/confirm')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Avatar updated')
  confirmAvatar(
    @CurrentUser() context: RequestContext,
    @Body() dto: ConfirmAvatarDto,
  ): Promise<UserResponseDto> {
    return this.users.confirmAvatar(dto, context);
  }

  /**
   * 200 with the updated user, not 204.
   *
   * The client needs the row back to re-render the profile with `avatarUrl`
   * null — a 204 would leave it guessing whether the change landed.
   */
  @ApiOperation({
    summary:
      'Clear avatar_url to null; emits the async delete of the object that was there',
  })
  @ApiWrappedResponse(UserResponseDto)
  @ApiFilterErrors(['401'])
  @InvalidateCache(CACHE_SCOPES.users, entityFromCaller('user'))
  @Delete('me/avatar')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Avatar removed')
  deleteAvatar(
    @CurrentUser() context: RequestContext,
  ): Promise<UserResponseDto> {
    return this.users.deleteAvatar(context);
  }
}
