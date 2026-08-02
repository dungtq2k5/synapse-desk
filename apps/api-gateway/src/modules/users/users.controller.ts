import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
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
   * `fullName`, `dob`, `gender`, `avatarUrl` — and nothing else.
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
}
