import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './bookings.entity';
import { BookingsService } from './bookings.service';
import { BookingCompletionScheduler } from './booking-completion.scheduler';
import { BookingsController } from './bookings.controller';
import { Provider } from '../providers/providers.entity';
import { User } from '../users/user.entity';
import { ProviderAvailability } from '../providers/provider-availability.entity';
import { Review } from '../reviews/review.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { StreamService } from '../stream/stream.service';
import { EmailVerifiedGuard } from '../auth/guards/email-verified.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Booking,
      Provider,
      User,
      ProviderAvailability,
      Review,
    ]),
    NotificationsModule,
  ],
  controllers: [BookingsController],
  providers: [
    BookingsService,
    BookingCompletionScheduler,
    StreamService,
    EmailVerifiedGuard,
  ],
})
export class BookingsModule {}
