import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OwnersService } from './owners.service';
import { UpdateOwnerProfileDto } from './dto/update-owner-profile.dto';

@UseGuards(JwtAuthGuard)
@Controller('owners')
export class OwnersController {
  constructor(private readonly ownersService: OwnersService) {}

  @Get('me')
  me(@Req() req: Request & { user: { id: string } }) {
    return this.ownersService.getMe(req.user.id);
  }

  @Patch('me')
  updateMe(
    @Req() req: Request & { user: { id: string } },
    @Body() dto: UpdateOwnerProfileDto,
  ) {
    return this.ownersService.updateMe(req.user.id, dto);
  }
}
