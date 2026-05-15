import { Controller, Post, Get, Patch, Param, Body, Request, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guards';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateBookingDto } from './dto/create-booking.dto';
import { DeclineBookingDto } from './dto/decline-booking.dto';
import { RescheduleBookingDto } from './dto/reschedule-booking.dto';

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
  @Get('owner/spending')
  ownerSpending(@Request() req: any) {
    return this.bookingsService.getOwnerSpending(req.user.id as string);
  }

  @Roles('provider')
  @Get('provider/earnings')
  providerEarnings(@Request() req: any) {
    return this.bookingsService.getProviderEarnings(req.user.id as string);
  }

  @Roles('provider')
  @Get('provider/stats')
  providerStats(@Request() req: any) {
    return this.bookingsService.getProviderStats(req.user.id as string);
  }

  @Roles('provider')
  @Get('provider')
  listForProvider(@Request() req: any) {
    return this.bookingsService.getProviderBookings(req.user.id as string);
  }

  @Roles('owner')
  @Post(':id/reschedule')
  reschedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: RescheduleBookingDto,
  ) {
    return this.bookingsService.rescheduleBooking(id, req.user.id as string, dto.newDatetime);
  }

  @Roles('owner')
  @Patch(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.bookingsService.cancelBooking(id, req.user.id as string);
  }

  @Roles('provider')
  @Patch(':id/accept')
  accept(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.bookingsService.acceptBooking(id, req.user.id as string);
  }

  @Roles('provider')
  @Patch(':id/decline')
  decline(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: DeclineBookingDto,
  ) {
    return this.bookingsService.declineBooking(id, req.user.id as string, dto.reason);
  }

  @Roles('provider')
  @Patch(':id/complete')
  complete(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.bookingsService.completeBooking(id, req.user.id as string);
  }
}
