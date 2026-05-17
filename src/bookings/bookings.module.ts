import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './bookings.entity';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { Provider } from '../providers/providers.entity';
import { User } from '../users/user.entity';
import { ProviderAvailability } from '../providers/provider-availability.entity';
import { Review } from '../reviews/review.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [TypeOrmModule.forFeature([Booking, Provider, User, ProviderAvailability, Review]), NotificationsModule],
  controllers: [BookingsController],
  providers: [BookingsService],
})
export class BookingsModule {}
