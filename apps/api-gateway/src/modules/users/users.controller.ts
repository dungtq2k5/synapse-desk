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
import { UserServiceGrpcClient } from './users-service-grpc.client';
import {
  CurrentUserResponseDto,
  UserResponseDto,
} from './dto/rest/user-response.dto';
import { UpdateOwnProfileDto } from './dto/rest/update-user.dto';
import {
  ConfirmAvatarDto,
  PresignAvatarDto,
  PresignAvatarResponseDto,
} from './dto/rest/avatar.dto';
import { OrgAccessKind } from '../../common/decorators/org-access.decorator';

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
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly usersGrpcClient: UserServiceGrpcClient,
  ) {}

  /**
   * Takes the whole RequestContext rather than just `sub`: `ip` and `userAgent`
   * are two of its fields, so the origin needs no separate derivation once a
   * caller is authenticated.
   */
  @OrgAccessKind(OrgAccess.AUTH)
  @Get('me')
  getCurrentUser(
    @CurrentUser() context: RequestContext,
  ): Promise<CurrentUserResponseDto> {
    return this.usersService.getCurrentUser(context.sub, context);
  }

  /**
   * `fullName`, `dob`, `gender` — and nothing else.
   *
   * `avatarUrl` is NOT here: it is written only by the avatar confirm endpoint
   * below, which is what verifies the object was actually uploaded by this
   * caller and cleans up the one it replaces.
   *
   * `email` and `phoneNumber` change through the OTP flow, which is what proves
   * the new address belongs to the user; the rest are administrative. The DTO
   * is the enforcement: `forbidNonWhitelisted` rejects any other key with a
   * 400, so keeping it narrow is a security control rather than a convention.
   */
  @Patch('me')
  @ResponseMessage('Profile updated')
  updateOwnProfile(
    @CurrentUser() context: RequestContext,
    @Body() updateOwnProfileDto: UpdateOwnProfileDto,
  ): Promise<UserResponseDto> {
    return this.usersGrpcClient.updateOwnProfile(updateOwnProfileDto, context);
  }

  // ---------------------------------------------------------------- avatars

  /**
   * Step 1 of presign → upload → confirm — 10-storage-service.md §3.1.
   *
   * Returns a URL the CLIENT PUTs the bytes to directly, bypassing every
   * application server. That is the whole point of the design: a 2 MB image
   * never occupies a gateway request buffer, and the upload's throughput is
   * Google's problem rather than ours.
   *
   * No permission — this is the caller's own face.
   */
  @Post('me/avatar/upload-url')
  @HttpCode(HttpStatus.OK)
  presignAvatar(
    @CurrentUser() context: RequestContext,
    @Body() dto: PresignAvatarDto,
  ): Promise<PresignAvatarResponseDto> {
    return this.usersGrpcClient.presignAvatar(dto, context);
  }

  /**
   * Step 5–7: the client says it uploaded; auth-service verifies with
   * storage-service, commits the path, audits, and emits the supersede for the
   * OLD object.
   */
  @Post('me/avatar/confirm')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Avatar updated')
  confirmAvatar(
    @CurrentUser() context: RequestContext,
    @Body() dto: ConfirmAvatarDto,
  ): Promise<UserResponseDto> {
    return this.usersGrpcClient.confirmAvatar(dto, context);
  }

  /**
   * 200 with the updated user, not 204.
   *
   * The client needs the row back to re-render the profile with `avatarUrl`
   * null — a 204 would leave it guessing whether the change landed.
   */
  @Delete('me/avatar')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Avatar removed')
  deleteAvatar(
    @CurrentUser() context: RequestContext,
  ): Promise<UserResponseDto> {
    return this.usersGrpcClient.deleteAvatar(context);
  }
}
