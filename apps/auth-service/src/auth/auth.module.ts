import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions, JwtSignOptions } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthGrpcController } from './auth-grpc.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    // Access-token defaults live here; generate2faToken() overrides them
    // per-call with the 2FA secret and TTL.
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService): JwtModuleOptions => ({
        secret: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        // expiresIn is typed as ms.StringValue ('15m', '7d', ...), which a
        // plain env string can't be narrowed to — same cast as generate2faToken.
        signOptions: {
          expiresIn: configService.getOrThrow<string>('JWT_ACCESS_EXPIRES_IN'),
        } as JwtSignOptions,
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [AuthService],
  controllers: [AuthGrpcController],
})
export class AuthModule {}
