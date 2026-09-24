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
import { CreateReportDto } from './dto/create-report.dto';
import { ListReportsDto } from './dto/list-reports.dto';
import { UpdateReportStatusDto } from './dto/update-report-status.dto';
import { ReportsService } from './reports.service';

type AuthenticatedRequest = Request & { user: { id: string } };

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @Roles('owner', 'provider')
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateReportDto) {
    return this.reports.create(req.user.id, dto);
  }

  @Get('mine')
  @Roles('owner', 'provider')
  mine(@Req() req: AuthenticatedRequest, @Query() dto: ListReportsDto) {
    return this.reports.mine(req.user.id, dto);
  }
}

@Controller('admin/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list(@Query() dto: ListReportsDto) {
    return this.reports.adminList(dto);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.adminGet(id);
  }

  @Get(':id/conversation-context')
  conversationContext(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.adminConversationContext(id);
  }

  @Patch(':id/status')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateReportStatusDto,
  ) {
    return this.reports.updateStatus(id, req.user.id, dto);
  }
}
