import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1');

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🌐 [API Gateway] running on http://localhost:${port}/api/v1`);
}

bootstrap().catch((error) => {
  console.error('[API Gateway] Failed to start the application: ', error);
});
