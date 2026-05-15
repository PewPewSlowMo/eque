import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { TrpcRouter } from './trpc/trpc.router';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const corsOrigins = process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'];
  app.enableCors({ origin: corsOrigins, credentials: true });

  app.use('/api/backup/import', (req: any, res: any, next: any) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('express').json({ limit: '100mb' })(req, res, next);
  });

  app.useStaticAssets(join(process.cwd(), 'public'));

  const trpc = app.get(TrpcRouter);
  await trpc.applyMiddleware(app);

  const port = process.env.PORT || 3001;
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host);

  console.log(`🚀 Backend: http://localhost:${port}`);
  console.log(`🔗 tRPC: http://localhost:${port}/trpc`);
}

bootstrap();
