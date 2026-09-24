import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ProvidersService } from './providers.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guards';
import { EmailVerifiedGuard } from '../auth/guards/email-verified.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UpdateProviderDto } from './dto/update-provider.dto';
import { OnboardProviderDto } from './dto/onboard-provider.dto';
import { UpsertAvailabilityDto } from './dto/upsert-availability.dto';
import { CreateServiceDto } from '../services/dto/create-service.dto';
import { UpdateServiceDto } from '../services/dto/update-service.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('providers')
export class ProvidersController {
  constructor(private readonly providersService: ProvidersService) {}

  @Get()
  list(
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('radius') radius?: string,
  ) {
    if (lat === undefined && lng === undefined && radius === undefined) {
      return this.providersService.findAll();
    }
    const latNum = lat?.trim() ? Number(lat) : NaN;
    const lngNum = lng?.trim() ? Number(lng) : NaN;
    const radiusKm =
      radius === undefined ? 25 : radius.trim() ? Number(radius) : NaN;
    if (
      !Number.isFinite(latNum) ||
      Math.abs(latNum) > 90 ||
      !Number.isFinite(lngNum) ||
      Math.abs(lngNum) > 180 ||
      !Number.isFinite(radiusKm) ||
      radiusKm < 0
    ) {
      throw new BadRequestException(
        'Provide valid lat, lng and a non-negative radius in kilometres',
      );
    }
    return this.providersService.findNearby(latNum, lngNum, radiusKm);
  }

  @Post('onboard')
  @Roles('provider')
  onboard(
    @Req() req: Request & { user: { id: string } },
    @Body() dto: OnboardProviderDto,
  ) {
    return this.providersService.onboard(req.user.id, dto);
  }

  @Roles('provider')
  @Get('me')
  getMe(@Req() req: Request & { user: { id: string } }) {
    return this.providersService.findByUserId(req.user.id);
  }

  // me/availability must be defined before :id/availability to avoid ambiguity
  @Roles('provider')
  @Get('me/availability')
  getMyAvailability(@Req() req: Request & { user: { id: string } }) {
    return this.providersService.getMyAvailability(req.user.id);
  }

  @Roles('provider')
  @Put('me/availability')
  upsertAvailability(
    @Req() req: Request & { user: { id: string } },
    @Body() dto: UpsertAvailabilityDto,
  ) {
    return this.providersService.upsertAvailability(req.user.id, dto);
  }

  @Roles('provider')
  @Patch('me')
  updateMe(
    @Req() req: Request & { user: { id: string } },
    @Body() dto: UpdateProviderDto,
  ) {
    return this.providersService.updateByUserId(req.user.id, dto);
  }

  @Roles('provider')
  @Post('services')
  addService(
    @Req() req: Request & { user: { id: string } },
    @Body() dto: CreateServiceDto,
  ) {
    return this.providersService.addService(req.user.id, dto);
  }

  @Roles('provider')
  @Patch('services/:id')
  updateService(
    @Req() req: Request & { user: { id: string } },
    @Param('id', ParseUUIDPipe) serviceId: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.providersService.updateServicebyId(req.user.id, serviceId, dto);
  }

  // Public — any authenticated user (owner needs this when booking)
  @Get(':id/availability')
  getProviderAvailability(@Param('id', ParseUUIDPipe) id: string) {
    return this.providersService.getProviderAvailability(id);
  }

  // Ensures the provider's Stream Chat user exists before opening a DM channel.
  @Post(':id/init-chat')
  @UseGuards(EmailVerifiedGuard)
  initChat(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: { id: string } },
  ) {
    return this.providersService.initChatForProvider(id, req.user.id);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.providersService.findOne(id);
  }
}
