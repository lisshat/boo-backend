import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guards';
import { BookingStatus } from '../bookings/bookings.entity';
import type { UserRole } from '../users/user.entity';
import { VerificationDocumentStatus } from '../verification/verification-document.entity';
import { AdminService } from './admin.service';
import { ReviewVerificationDto } from './dto/review-verification.dto';
import { UpdateUserBanDto } from './dto/update-user-ban.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('verification')
  getVerification(
    @Query('status') status?: VerificationDocumentStatus | 'all',
    @Query('search') search?: string,
  ) {
    return this.adminService.getVerificationQueue(
      status ?? VerificationDocumentStatus.PENDING,
      search,
    );
  }

  @Patch('verification/:docId')
  reviewVerification(
    @Param('docId', ParseUUIDPipe) docId: string,
    @Req() req: Request & { user: { id: string } },
    @Body() dto: ReviewVerificationDto,
  ) {
    return this.adminService.reviewVerificationDocument(
      docId,
      req.user.id,
      dto,
    );
  }

  @Get('users')
  getUsers(
    @Query('role') role?: UserRole,
    @Query('isBanned') isBanned?: string,
  ) {
    return this.adminService.getUsers(role, isBanned);
  }

  @Patch('users/:id')
  updateUserBan(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: { id: string } },
    @Body() dto: UpdateUserBanDto,
  ) {
    return this.adminService.updateUserBanStatus(id, req.user.id, dto);
  }

  @Get('users/:id/bookings')
  getUserBookingHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getUserBookingHistory(id);
  }

  @Post('users/:id/warn')
  warnUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: { id: string } },
  ) {
    return this.adminService.warnUser(id, req.user.id);
  }

  @Get('audit-log')
  getAuditLog() {
    return this.adminService.getAuditLog();
  }

  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }

  @Get('bookings')
  getBookings(
    @Query('status') status: BookingStatus | 'all' = 'all',
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.adminService.getBookings(status, Number(page), Number(limit));
  }

  @Get('services')
  getServices(
    @Query('category') category?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.adminService.getServices(category, isActive);
  }

  @Get('flagged-users')
  getFlaggedUsers() {
    return this.adminService.getFlaggedUsers();
  }

  @Get('reports/provider-performance')
  async getProviderPerformanceReport(
    @Req() req: Request & { user: { id: string } },
    @Query('isVerified') isVerified?: string,
    @Query('category') category?: string,
    @Query('minRating') minRating?: string,
    @Query('sortBy') sortBy?: 'rating' | 'bookings' | 'reviews',
  ) {
    const result = await this.adminService.getProviderPerformanceReport({
      isVerified,
      category,
      minRating,
      sortBy,
    });
    await this.adminService.logAdminAction(
      req.user.id,
      'report_generated',
      'report',
      undefined,
      {
        report: 'provider-performance',
        isVerified,
        category,
        minRating,
        sortBy,
      },
    );
    return result;
  }

  @Get('reports/booking-activity')
  async getBookingActivityReport(
    @Req() req: Request & { user: { id: string } },
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: string,
    @Query('groupBy') groupBy?: 'week' | 'month',
  ) {
    const result = await this.adminService.getBookingActivityReport({
      startDate,
      endDate,
      status,
      groupBy,
    });
    await this.adminService.logAdminAction(
      req.user.id,
      'report_generated',
      'report',
      undefined,
      {
        report: 'booking-activity',
        startDate,
        endDate,
        status,
        groupBy,
      },
    );
    return result;
  }

  @Get('reports/service-catalog')
  async getServiceCatalogReport(
    @Req() req: Request & { user: { id: string } },
    @Query('category') category?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('isActive') isActive?: string,
  ) {
    const result = await this.adminService.getServiceCatalogReport({
      category,
      minPrice,
      maxPrice,
      isActive,
    });
    await this.adminService.logAdminAction(
      req.user.id,
      'report_generated',
      'report',
      undefined,
      {
        report: 'service-catalog',
        category,
        minPrice,
        maxPrice,
        isActive,
      },
    );
    return result;
  }

  @Get('reports/trust-safety')
  async getTrustSafetyReport(
    @Req() req: Request & { user: { id: string } },
    @Query('minCancellations') minCancellations?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const result = await this.adminService.getTrustSafetyReport({
      minCancellations,
      startDate,
      endDate,
    });
    await this.adminService.logAdminAction(
      req.user.id,
      'report_generated',
      'report',
      undefined,
      {
        report: 'trust-safety',
        minCancellations,
        startDate,
        endDate,
      },
    );
    return result;
  }

  @Get('reports/pet-ownership')
  async getPetOwnershipReport(
    @Req() req: Request & { user: { id: string } },
    @Query('minPets') minPets?: string,
  ) {
    const result = await this.adminService.getPetOwnershipReport({ minPets });
    await this.adminService.logAdminAction(
      req.user.id,
      'report_generated',
      'report',
      undefined,
      { report: 'pet-ownership', minPets },
    );
    return result;
  }

  @Get('reports/pet-activity')
  async getPetActivityReport(
    @Req() req: Request & { user: { id: string } },
    @Query('species') species?: string,
  ) {
    const result = await this.adminService.getPetActivityReport({ species });
    await this.adminService.logAdminAction(
      req.user.id,
      'report_generated',
      'report',
      undefined,
      { report: 'pet-activity', species },
    );
    return result;
  }

  @Get('reports/user-summary')
  async getUserSummaryReport(
    @Req() req: Request & { user: { id: string } },
    @Query('role') role?: UserRole,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const result = await this.adminService.getUserSummaryReport({
      role,
      startDate,
      endDate,
    });
    await this.adminService.logAdminAction(
      req.user.id,
      'report_generated',
      'report',
      undefined,
      {
        report: 'user-summary',
        role,
        startDate,
        endDate,
      },
    );
    return result;
  }
}
