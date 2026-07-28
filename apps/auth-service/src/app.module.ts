import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { envValidationSchema } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Makes ConfigService available without re-importing
      validationSchema: envValidationSchema,
      validationOptions: {
        allowUnknown: true, // Ignore env vars not declared in the schema
      },
    }),
    PrismaModule,
    AuthModule,
  ],
})
export class AppModule {}
