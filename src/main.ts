import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
// main.ts — add this import
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors(); // this allows frontend apps to access api 

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,               // Strips away data that isn't in the DTO
    forbidNonWhitelisted: true,    // Throws an error if extra data is sent
    transform: true,               // Automatically converts types (e.g., string to number)
  }));

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
