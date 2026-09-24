import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking, BookingStatus } from './bookings.entity';
import { BookingsService } from './bookings.service';

@Injectable()
export class BookingCompletionScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(BookingCompletionScheduler.name);
  private readonly intervalMs = 5 * 60 * 1000;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    private readonly bookingsService: BookingsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.scan();
    }, this.intervalMs);
    // Pick up overdue bookings after a restart without blocking startup.
    void this.scan();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async scan(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const candidates = await this.bookingRepo
        .createQueryBuilder('booking')
        .select(['booking.bookingId', 'booking.providerId'])
        .where('booking.status = :status', { status: BookingStatus.ACCEPTED })
        .getMany();

      for (const candidate of candidates) {
        try {
          await this.bookingsService.completeBookingAutomatically(
            candidate.bookingId,
            candidate.providerId,
          );
        } catch (error: any) {
          const category =
            error?.name === 'BadRequestException'
              ? 'invalid_duration'
              : 'completion_error';
          this.logger.warn(
            `Automatic completion skipped booking=${candidate.bookingId} category=${category}`,
          );
        }
      }
    } catch (_) {
      this.logger.error('Automatic completion scan failed category=scan_error');
    } finally {
      this.running = false;
    }
  }
}
