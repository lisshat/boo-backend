import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { RevenueCatWebhookEvent } from './revenuecat-webhook-event.entity';
import { UserEntitlement } from './user-entitlement.entity';
import { RevenueCatWebhookController } from './revenuecat-webhook.controller';
import { RevenueCatEntitlementsService } from './revenuecat-entitlements.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([User, RevenueCatWebhookEvent, UserEntitlement]),
  ],
  controllers: [RevenueCatWebhookController],
  providers: [RevenueCatEntitlementsService],
  exports: [RevenueCatEntitlementsService],
})
export class RevenueCatModule {}
