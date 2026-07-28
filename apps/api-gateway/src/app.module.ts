import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './common/config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Makes ConfigService available globally
      validationSchema: envValidationSchema,
      validationOptions: {
        allowUnknown: true, // Ignore env variables that are not defined in the validation schema
      },
    }),
    AuthModule,
  ],
})
export class AppModule {}
