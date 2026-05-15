import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guards';
import { UploadVerificationDto } from './dto/upload-verification.dto';
import { VerificationService } from './verification.service';

@Controller('verification')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('provider')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Post('upload')
  upload(
    @Req() req: Request & { user: { id: string } },
    @Body() dto: UploadVerificationDto,
  ) {
    return this.verificationService.uploadDocument(req.user.id, dto);
  }

  @Get('status')
  getStatus(@Req() req: Request & { user: { id: string } }) {
    return this.verificationService.getStatus(req.user.id);
  }
}
