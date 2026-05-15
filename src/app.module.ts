import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { User } from './users/user.entity';
import { Booking } from './bookings/bookings.entity';
import { BookingsModule } from './bookings/bookings.module';
import { Provider } from './providers/providers.entity';
import { ServiceOffering } from './providers/service-offering.entity';
import { ProvidersModule } from './providers/providers.module';
import { Pet } from './pets/pet.entity';
import { PetsModule } from './pets/pets.module';
import { Notification } from './notifications/notification.entity';
import { NotificationsModule } from './notifications/notifications.module';
import { ProviderAvailability } from './providers/provider-availability.entity';
import { Review } from './reviews/review.entity';
import { ReviewsModule } from './reviews/reviews.module';
import { VerificationDocument } from './verification/verification-document.entity';
import { VerificationModule } from './verification/verification.module';
import { AdminModule } from './admin/admin.module';
import { AdminAuditLog } from './admin/admin-audit-log.entity';
import { PasswordResetToken } from './auth/password-reset-token.entity';
import { OwnerProfile } from './owners/owner-profile.entity';
import { OwnersModule } from './owners/owners.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: 'src/.env',
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        entities: [
          User,
          Booking,
          Provider,
          ServiceOffering,
          Pet,
          Notification,
          ProviderAvailability,
          Review,
          VerificationDocument,
          AdminAuditLog,
          PasswordResetToken,
          OwnerProfile,
        ],
        synchronize: false,
        ssl: { rejectUnauthorized: false },
      }),
    }),
    AuthModule,
    BookingsModule,
    ProvidersModule,
    PetsModule,
    NotificationsModule,
    ReviewsModule,
    VerificationModule,
    AdminModule,
    OwnersModule,
  ],
})
export class AppModule {}
