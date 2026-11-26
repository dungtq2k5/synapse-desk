import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
  PayloadTooLargeException,
  RequestMethod,
} from '@nestjs/common';
import { CLIENT_ERROR_MAX_BYTES } from '@synapsedesk/contracts';
import type { NextFunction, Request, Response } from 'express';
import { AuthModule } from '../auth/auth.module';
import { API_VERSION } from '../health/ops-routes';
import { ClientErrorsController } from './client-errors.controller';

@Module({
  imports: [AuthModule],
  controllers: [ClientErrorsController],
})
export class ClientErrorsModule implements NestModule {
  /**
   * The size cap, by the declared length, before validation reads the body.
   *
   * For every method, so Nest mounts it with `all()`, which the HTTP metrics
   * recorder reads as a middleware's route: its refusal is
   * `refused-before-routing`, not a handler's template.
   */
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
      .forRoutes({
        path: 'client-errors',
        method: RequestMethod.ALL,
        version: API_VERSION,
      });
  }
}
