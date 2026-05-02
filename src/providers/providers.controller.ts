import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ProvidersService } from './providers.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateProviderDto } from './dto/update-provider.dto';
import { OnboardProviderDto } from './dto/onboard-provider.dto';

@UseGuards(JwtAuthGuard)
@Controller('providers')
export class ProvidersController {
  constructor(private readonly providersService: ProvidersService) {}

  @Get()
  list() {
    return this.providersService.findAll();
  }

  @Post('onboard')
  onboard(
    @Req() req: Request & { user: { id: string } },
    @Body() dto: OnboardProviderDto,
  ) {
    return this.providersService.onboard(req.user.id, dto);
  }

  @Get('me')
  getMe(@Req() req: Request & { user: { id: string } }) {
    return this.providersService.findByUserId(req.user.id);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.providersService.findOne(id);
  }

  @Patch('me')
  updateMe(
    @Req() req: Request & { user: { id: string } },
    @Body() dto: UpdateProviderDto,
  ) {
    return this.providersService.updateByUserId(req.user.id, dto);
  }
}
