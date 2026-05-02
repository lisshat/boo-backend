import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { User } from './users/user.entity';
import { Booking } from './bookings/bookings.entity';
import { BookingsModule } from './bookings/bookings.module';
import { Provider } from './providers/providers.entity';
import { ServiceOffering } from './providers/service-offering.entity';
import { ProvidersModule } from './providers/providers.module';
import { Pet } from './pets/pet.entity';
import { PetsModule } from './pets/pets.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: 'src/.env',
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        entities: [User, Booking, Provider, ServiceOffering, Pet],
        synchronize: false,
        ssl: { rejectUnauthorized: false },
      }),
    }),
    AuthModule,
    BookingsModule,
    ProvidersModule,
    PetsModule,
  ],
})
export class AppModule {}
