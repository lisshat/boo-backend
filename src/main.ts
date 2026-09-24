import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Keep the public webhook parser strictly bounded. Other application
  // routes retain a larger JSON limit without allowing webhook payloads to
  // consume unbounded memory.
  app.use('/webhooks/revenuecat', express.json({ limit: '32kb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.use(helmet());

  const allowed = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (moe apps, curl)
      if (!origin) return callback(null, true);
      // Always allow any localhost port (Flutter web dev server)
      if (/^http:\/\/localhost(:\d+)?$/.test(origin))
        return callback(null, true);
      // Allow Android emulator host
      if (/^http:\/\/10\.0\.2\.2(:\d+)?$/.test(origin))
        return callback(null, true);
      // Allow explicit production origins from env
      if (allowed.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
