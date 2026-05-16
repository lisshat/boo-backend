import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from '../bookings/bookings.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { Provider } from '../providers/providers.entity';
import { ServiceOffering } from '../providers/service-offering.entity';
import { Review } from '../reviews/review.entity';
import { StreamService } from '../stream/stream.service';
import { User } from '../users/user.entity';
import { VerificationDocument } from '../verification/verification-document.entity';
import { AdminAuditLog } from './admin-audit-log.entity';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      VerificationDocument,
      Provider,
      User,
      Booking,
      ServiceOffering,
      Review,
      AdminAuditLog,
    ]),
    NotificationsModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, StreamService],
})
export class AdminModule {}
