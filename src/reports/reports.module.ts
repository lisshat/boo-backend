import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuditLog } from '../admin/admin-audit-log.entity';
import { Booking } from '../bookings/bookings.entity';
import { Provider } from '../providers/providers.entity';
import { StreamService } from '../stream/stream.service';
import { User } from '../users/user.entity';
import { Report } from './report.entity';
import {
  AdminReportsController,
  ReportsController,
} from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Report, User, Provider, Booking, AdminAuditLog]),
  ],
  controllers: [ReportsController, AdminReportsController],
  providers: [ReportsService, StreamService],
})
export class ReportsModule {}
