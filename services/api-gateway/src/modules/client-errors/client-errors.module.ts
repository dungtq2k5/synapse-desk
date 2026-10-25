import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
  PayloadTooLargeException,
} from '@nestjs/common';
import { CLIENT_ERROR_MAX_BYTES } from '@synapsedesk/contracts';
import type { NextFunction, Request, Response } from 'express';
import { AuthModule } from '../auth/auth.module';
import { ClientErrorsController } from './client-errors.controller';

@Module({
  imports: [AuthModule],
  controllers: [ClientErrorsController],
})
export class ClientErrorsModule implements NestModule {
  /** The size cap, by the declared length, before validation reads the body. */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply((request: Request, _response: Response, next: NextFunction) => {
        if (
          Number(request.headers['content-length'] ?? 0) >
          CLIENT_ERROR_MAX_BYTES
        ) {
          throw new PayloadTooLargeException(
            `A report is at most ${CLIENT_ERROR_MAX_BYTES} bytes`,
          );
        }
        next();
      })
      .forRoutes(ClientErrorsController);
  }
}
