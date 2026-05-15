import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Provider } from './providers.entity';
import { ServiceOffering } from './service-offering.entity';
import { ProviderAvailability } from './provider-availability.entity';
import { ProvidersService } from './providers.service';
import { ProvidersController } from './providers.controller';
import { User } from '../users/user.entity';
import { StreamService } from '../stream/stream.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Provider, ServiceOffering, ProviderAvailability, User]),
  ],
  controllers: [ProvidersController],
  providers: [ProvidersService, StreamService],
  exports: [ProvidersService],
})
export class ProvidersModule {}
