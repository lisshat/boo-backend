import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PetsService } from './pets.service';
import { CreatePetDto } from './dto/create-pet.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('pets')
export class PetsController {
  constructor(private readonly petsService: PetsService) {}

  @Post()
  create(
    @Req() req: Request & { user: { id: string } },
    @Body() dto: CreatePetDto,
  ) {
    return this.petsService.create(req.user.id, dto);
  }

  @Get('me')
  myPets(@Req() req: Request & { user: { id: string } }) {
    return this.petsService.findByOwnerId(req.user.id);
  }
}
