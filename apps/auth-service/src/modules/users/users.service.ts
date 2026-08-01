import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { CurrentUserResponse } from '@synapsedesk/grpc-proto';
import { toUserResponse } from './user.mapper';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get current user profile + effective permissions.
   *
   * This is the SPA's bootstrap call, so it returns everything the client needs
   * to render its navigation in one round trip.
   */
  async getCurrentUser(userId: string): Promise<CurrentUserResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        organization: true,
        userDepartments: { include: { department: true } }, // explicit junction — this one is right
        roles: { include: { permissions: true } }, // implicit M2M — direct
      },
    });
    if (!user || user.deletedAt) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'User not found',
      });
    }

    return {
      user: toUserResponse(user),
      // Flattened across roles and de-duplicated: two roles granting
      // `ticket.read` must not produce it twice.
      permissionCodes: [
        ...new Set(user.roles.flatMap((r) => r.permissions.map((p) => p.code))),
      ],
      departmentIds: user.userDepartments.map((ud) => ud.departmentId),
    };
  }
}
