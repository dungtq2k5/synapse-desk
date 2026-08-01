import { Controller, Get, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUserResponseDto } from './dto/rest/current-user-response.dto';
import { RequestContext } from '@synapsedesk/common';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Takes the whole RequestContext rather than just `sub`: `ip` and `userAgent`
   * are two of its seven fields, so the origin needs no separate derivation
   * once a caller is authenticated.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  getCurrentUser(
    @CurrentUser() context: RequestContext,
  ): Promise<CurrentUserResponseDto> {
    return this.usersService.getCurrentUser(context.sub, context);
  }
}
