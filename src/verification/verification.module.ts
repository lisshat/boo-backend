import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { Provider } from '../providers/providers.entity';
import { User } from '../users/user.entity';
import { VerificationController } from './verification.controller';
import { VerificationDocument } from './verification-document.entity';
import { VerificationService } from './verification.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([VerificationDocument, Provider, User]),
    NotificationsModule,
  ],
  controllers: [VerificationController],
  providers: [VerificationService],
  exports: [VerificationService],
})
export class VerificationModule {}
