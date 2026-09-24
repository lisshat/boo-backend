import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './notification.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import {
  OneSignalHttpTransport,
  OneSignalPushService,
} from './onesignal-push.service';

@Module({
  imports: [TypeOrmModule.forFeature([Notification])],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    OneSignalHttpTransport,
    OneSignalPushService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
