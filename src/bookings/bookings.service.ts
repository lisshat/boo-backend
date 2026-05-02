import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking, BookingStatus } from './bookings.entity';
import { CreateBookingDto } from './dto/create-booking.dto';

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
  ) {}

  async createBooking(ownerId: string, dto: CreateBookingDto): Promise<Booking> {
    const booking = this.bookingRepo.create({
      ownerId,
      providerId: dto.providerId,
      serviceId: dto.serviceId,
      petId: dto.petId ?? null,
      bookingDatetime: new Date(dto.bookingDatetime),
      notes: dto.notes ?? null,
      status: BookingStatus.PENDING,
    });
    return this.bookingRepo.save(booking);
  }

  async getBookings(ownerId: string): Promise<Booking[]> {
    return this.bookingRepo.find({
      where: { ownerId },
      order: { createdAt: 'DESC' },
    });
  }

  async cancelBooking(bookingId: string, ownerId: string): Promise<Booking> {
    const booking = await this.bookingRepo.findOne({
      where: { bookingId, ownerId },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    booking.status = BookingStatus.CANCELLED;
    return this.bookingRepo.save(booking);
  }
}
