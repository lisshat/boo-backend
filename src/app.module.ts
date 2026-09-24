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
import { PasswordResetCode } from './auth/password-reset-code.entity';
import { OwnerProfile } from './owners/owner-profile.entity';
import { OwnersModule } from './owners/owners.module';
import { Report } from './reports/report.entity';
import { ReportsModule } from './reports/reports.module';
import { EmailVerificationCode } from './auth/email-verification-code.entity';
import { RevenueCatModule } from './revenuecat/revenuecat.module';
import { RevenueCatWebhookEvent } from './revenuecat/revenuecat-webhook-event.entity';
import { UserEntitlement } from './revenuecat/user-entitlement.entity';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
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
          PasswordResetCode,
          EmailVerificationCode,
          RevenueCatWebhookEvent,
          UserEntitlement,
          OwnerProfile,
          Report,
        ],
        // Opt in only for development database setup; production uses migrations.
        synchronize:
          config.get<string>('NODE_ENV') === 'development' &&
          config.get<string>('DATABASE_SYNCHRONIZE') === 'true',
        // Hosted databases opt in with DATABASE_SSL=true; local PostgreSQL defaults to no SSL.
        ssl:
          config.get<string>('DATABASE_SSL') === 'true'
            ? { rejectUnauthorized: false }
            : false,
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
    ReportsModule,
    RevenueCatModule,
  ],
})
export class AppModule {}
