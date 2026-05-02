import { Controller, Post, Get, Patch, Param, Body, Request, UseGuards } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guards';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateBookingDto } from './dto/create-booking.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Roles('owner')
  @Post()
  create(@Request() req: any, @Body() dto: CreateBookingDto) {
    return this.bookingsService.createBooking(req.user.id as string, dto);
  }

  @Roles('owner')
  @Get()
  list(@Request() req: any) {
    return this.bookingsService.getBookings(req.user.id as string);
  }

  @Roles('owner')
  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @Request() req: any) {
    return this.bookingsService.cancelBooking(id, req.user.id as string);
  }
}
