import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { Booking, BookingStatus } from './bookings.entity';
import { Provider } from '../providers/providers.entity';
import { User } from '../users/user.entity';
import { ProviderAvailability } from '../providers/provider-availability.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateBookingDto } from './dto/create-booking.dto';

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(Provider)
    private readonly providerRepo: Repository<Provider>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(ProviderAvailability)
    private readonly availabilityRepo: Repository<ProviderAvailability>,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async validateAvailability(
    providerId: string,
    bookingDatetime: Date,
  ): Promise<void> {
    const dayOfWeek = bookingDatetime.getDay();
    const bookingTime = bookingDatetime.toTimeString().substring(0, 5);

    const availability = await this.availabilityRepo.findOne({
      where: { profileId: providerId, dayOfWeek, isAvailable: true },
    });

    if (!availability) {
      const hasAny = await this.availabilityRepo.count({
        where: { profileId: providerId },
      });
      if (hasAny === 0) {
        console.warn(`Provider ${providerId} has no availability configured`);
        return;
      }
      throw new BadRequestException(
        'The provider is not available on this day. Please choose another date.',
      );
    }

    const startTime = availability.startTime.substring(0, 5);
    const endTime = availability.endTime.substring(0, 5);

    if (bookingTime < startTime || bookingTime >= endTime) {
      throw new BadRequestException(
        `Provider is only available between ${startTime} and ${endTime} on this day.`,
      );
    }
  }

  async createBooking(ownerId: string, dto: CreateBookingDto): Promise<Booking> {
    const bookingDatetime = new Date(dto.bookingDatetime);
    bookingDatetime.setSeconds(0, 0);

    if (bookingDatetime <= new Date())
      throw new BadRequestException('Cannot book a time slot in the past');

    await this.validateAvailability(dto.providerId, bookingDatetime);

    const booking = this.bookingRepo.create({
      ownerId,
      providerId: dto.providerId,
      serviceId: dto.serviceId,
      petId: dto.petId ?? null,
      bookingDatetime,
      notes: dto.notes ?? null,
      status: BookingStatus.PENDING,
    });
    try {
      await this.bookingRepo.save(booking);
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new ConflictException(
          'You already have a pending booking for this service at this time',
        );
      }
      throw err;
    }

    const provider = await this.providerRepo.findOne({ where: { id: dto.providerId } });
    if (provider) {
      await this.notificationsService.createNotification(
        provider.userId,
        'booking_request',
        'New Booking Request',
        'You have a new booking request.',
        booking.bookingId,
      );
    }

    return booking;
  }

  async getBookings(ownerId: string): Promise<Booking[]> {
    return this.bookingRepo.find({
      where: { ownerId },
      relations: ['provider', 'service'],
      order: { createdAt: 'DESC' },
    });
  }

  async getProviderBookings(userId: string): Promise<Booking[]> {
    const provider = await this.providerRepo.findOne({ where: { userId } });
    if (!provider) throw new NotFoundException('Provider profile not found');
    return this.bookingRepo.find({
      where: { providerId: provider.id },
      relations: ['service', 'owner'],
      order: { createdAt: 'DESC' },
    });
  }

  async getProviderEarnings(userId: string) {
    const provider = await this.providerRepo.findOne({ where: { userId } });
    if (!provider) throw new NotFoundException('Provider profile not found');

    const rows: Array<Record<string, unknown>> = await this.bookingRepo.query(
      `
      SELECT
        b.booking_id,
        b.booking_datetime,
        b.status,
        s.service_name,
        s.category,
        CASE
          WHEN s.pricing_unit = 'per_hour'
            THEN s.price::numeric * (s.duration_minutes::numeric / 60.0)
          ELSE s.price::numeric
        END AS price,
        u.full_name         AS owner_name
      FROM bookings b
      JOIN services s ON s.service_id = b.service_id
      JOIN users u ON u.id = b.owner_id
      WHERE b.provider_id = $1
        AND b.status IN ('completed', 'accepted', 'pending')
      ORDER BY b.booking_datetime DESC
      `,
      [provider.id],
    );

    const completed = rows.filter((r) => r.status === 'completed');
    const totalEarnings = completed.reduce(
      (sum, r) => sum + parseFloat(r.price as string),
      0,
    );

    const byCategory: Record<string, number> = {};
    for (const r of completed) {
      const cat = (r.category as string) ?? 'other';
      byCategory[cat] = (byCategory[cat] ?? 0) + parseFloat(r.price as string);
    }

    const byMonth: Record<string, number> = {};
    for (const r of completed) {
      const dt = new Date(r.booking_datetime as string);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      byMonth[key] = (byMonth[key] ?? 0) + parseFloat(r.price as string);
    }

    return {
      summary: {
        totalEarnings: parseFloat(totalEarnings.toFixed(2)),
        completedCount: completed.length,
        pendingCount: rows.filter(
          (r) => r.status === 'accepted' || r.status === 'pending',
        ).length,
      },
      byCategory: Object.entries(byCategory)
        .map(([category, total]) => ({
          category,
          total: parseFloat(total.toFixed(2)),
        }))
        .sort((a, b) => b.total - a.total),
      byMonth: Object.entries(byMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, total]) => ({
          month,
          total: parseFloat(total.toFixed(2)),
        })),
      recentBookings: rows.slice(0, 20).map((r) => ({
        id: r.booking_id,
        date: r.booking_datetime,
        owner: r.owner_name,
        service: r.service_name,
        category: r.category,
        price: parseFloat(r.price as string),
        status: r.status,
      })),
    };
  }

  async getOwnerSpending(ownerId: string) {
    const rows: Array<Record<string, unknown>> = await this.bookingRepo.query(
      `
      SELECT
        b.booking_id,
        b.booking_datetime,
        b.status,
        s.service_name,
        s.category,
        s.price::numeric    AS price,
        p.business_name     AS provider_name
      FROM bookings b
      JOIN services s ON s.service_id = b.service_id
      JOIN provider_profiles p ON p.profile_id = b.provider_id
      WHERE b.owner_id = $1
        AND b.status IN ('completed', 'accepted', 'pending')
      ORDER BY b.booking_datetime DESC
      `,
      [ownerId],
    );

    const completed = rows.filter((r) => r.status === 'completed');
    const totalSpent = completed.reduce(
      (sum, r) => sum + parseFloat(r.price as string),
      0,
    );

    const byCategory: Record<string, number> = {};
    for (const r of completed) {
      const cat = (r.category as string) ?? 'other';
      byCategory[cat] = (byCategory[cat] ?? 0) + parseFloat(r.price as string);
    }

    const byMonth: Record<string, number> = {};
    for (const r of completed) {
      const dt = new Date(r.booking_datetime as string);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      byMonth[key] = (byMonth[key] ?? 0) + parseFloat(r.price as string);
    }

    return {
      summary: {
        totalSpent: parseFloat(totalSpent.toFixed(2)),
        completedCount: completed.length,
        upcomingCount: rows.filter(
          (r) => r.status === 'accepted' || r.status === 'pending',
        ).length,
      },
      byCategory: Object.entries(byCategory)
        .map(([category, total]) => ({
          category,
          total: parseFloat(total.toFixed(2)),
        }))
        .sort((a, b) => b.total - a.total),
      byMonth: Object.entries(byMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, total]) => ({
          month,
          total: parseFloat(total.toFixed(2)),
        })),
      recentBookings: rows.slice(0, 20).map((r) => ({
        id: r.booking_id,
        date: r.booking_datetime,
        provider: r.provider_name,
        service: r.service_name,
        category: r.category,
        price: parseFloat(r.price as string),
        status: r.status,
      })),
    };
  }

  async getProviderStats(userId: string): Promise<{
    todayCount: number;
    pendingCount: number;
    totalCompleted: number;
    todayBookings: Booking[];
  }> {
    const provider = await this.providerRepo.findOne({ where: { userId } });
    if (!provider) throw new NotFoundException('Provider profile not found');

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const [todayCount, pendingCount, totalCompleted, todayBookings] = await Promise.all([
      // Confirmed jobs today
      this.bookingRepo.count({
        where: {
          providerId: provider.id,
          status: BookingStatus.ACCEPTED,
          bookingDatetime: Between(startOfDay, endOfDay),
        },
      }),
      // All pending requests (not just today)
      this.bookingRepo.count({
        where: { providerId: provider.id, status: BookingStatus.PENDING },
      }),
      // All-time completed bookings (clients served)
      this.bookingRepo.count({
        where: { providerId: provider.id, status: BookingStatus.COMPLETED },
      }),
      // Dashboard section: all pending requests (any date) + today's accepted bookings
      this.bookingRepo.find({
        where: [
          { providerId: provider.id, status: BookingStatus.PENDING },
          {
            providerId: provider.id,
            status: BookingStatus.ACCEPTED,
            bookingDatetime: Between(startOfDay, endOfDay),
          },
        ],
        relations: ['service', 'owner'],
        order: { bookingDatetime: 'ASC' },
      }),
    ]);

    return { todayCount, pendingCount, totalCompleted, todayBookings };
  }

  async acceptBooking(bookingId: string, userId: string): Promise<Booking> {
    const provider = await this.providerRepo.findOne({ where: { userId } });
    if (!provider) throw new NotFoundException('Provider profile not found');
    const booking = await this.bookingRepo.findOne({
      where: { bookingId, providerId: provider.id },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== BookingStatus.PENDING)
      throw new BadRequestException('Only pending bookings can be accepted');
    booking.status = BookingStatus.ACCEPTED;
    await this.bookingRepo.save(booking);

    await this.notificationsService.createNotification(
      booking.ownerId,
      'booking_accepted',
      'Booking Confirmed',
      'Your booking has been accepted.',
      bookingId,
    );

    return booking;
  }

  async declineBooking(bookingId: string, userId: string, reason?: string): Promise<Booking> {
    const provider = await this.providerRepo.findOne({ where: { userId } });
    if (!provider) throw new NotFoundException('Provider profile not found');
    const booking = await this.bookingRepo.findOne({
      where: { bookingId, providerId: provider.id },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== BookingStatus.PENDING)
      throw new BadRequestException('Only pending bookings can be declined');
    booking.status = BookingStatus.DECLINED;
    booking.declineReason = reason ?? null;
    await this.bookingRepo.save(booking);

    const reasonText = reason ? ` Reason: ${reason}` : '';
    await this.notificationsService.createNotification(
      booking.ownerId,
      'booking_declined',
      'Booking Declined',
      `Your booking was declined by the provider.${reasonText}`,
      bookingId,
    );

    return booking;
  }

  async completeBooking(bookingId: string, userId: string): Promise<Booking> {
    const provider = await this.providerRepo.findOne({ where: { userId } });
    if (!provider) throw new NotFoundException('Provider profile not found');
    const booking = await this.bookingRepo.findOne({
      where: { bookingId, providerId: provider.id },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== BookingStatus.ACCEPTED)
      throw new BadRequestException('Only accepted bookings can be marked complete');
    if (booking.bookingDatetime > new Date())
      throw new BadRequestException('Cannot complete a booking before its scheduled time');
    booking.status = BookingStatus.COMPLETED;
    await this.bookingRepo.save(booking);

    await this.notificationsService.createNotification(
      booking.ownerId,
      'booking_completed',
      'Service Complete',
      'Your booking is complete! How did it go?',
      bookingId,
    );

    return booking;
  }

  async rescheduleBooking(bookingId: string, ownerId: string, newDatetime: string): Promise<Booking> {
    const booking = await this.bookingRepo.findOne({
      where: { bookingId, ownerId },
      relations: ['service', 'provider'],
    });
    if (!booking) throw new NotFoundException('Booking not found');

    if (booking.status !== BookingStatus.PENDING && booking.status !== BookingStatus.ACCEPTED) {
      throw new BadRequestException('Only pending or accepted bookings can be rescheduled');
    }

    const newDt = new Date(newDatetime);
    newDt.setSeconds(0, 0);
    if (newDt <= new Date()) {
      throw new BadRequestException('New datetime must be in the future');
    }

    await this.validateAvailability(booking.providerId, newDt);

    const oldDatetime = booking.bookingDatetime;
    const fmt = (d: Date) => {
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const h = d.getUTCHours() % 12 || 12;
      const m = d.getUTCMinutes().toString().padStart(2, '0');
      const p = d.getUTCHours() >= 12 ? 'PM' : 'AM';
      return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${h}:${m} ${p}`;
    };

    booking.status = BookingStatus.RESCHEDULED;
    await this.bookingRepo.save(booking);

    const newBooking = this.bookingRepo.create({
      ownerId: booking.ownerId,
      providerId: booking.providerId,
      serviceId: booking.serviceId,
      petId: booking.petId,
      bookingDatetime: newDt,
      status: BookingStatus.PENDING,
      rescheduledFrom: booking.bookingId,
      notes: `Rescheduled from ${fmt(oldDatetime)}`,
    });
    await this.bookingRepo.save(newBooking);

    const owner = await this.userRepo.findOne({ where: { id: ownerId } });
    const ownerName = owner?.fullName ?? 'A pet owner';
    const serviceName = booking.service?.serviceName ?? 'your service';

    if (booking.provider) {
      await this.notificationsService.createNotification(
        booking.provider.userId,
        'booking_request',
        'Booking Rescheduled',
        `${ownerName} has rescheduled their ${serviceName} from ${fmt(oldDatetime)} to ${fmt(newDt)}. Please review and accept or decline.`,
        newBooking.bookingId,
      );
    }

    return newBooking;
  }

  async cancelBooking(bookingId: string, ownerId: string): Promise<Booking> {
    const booking = await this.bookingRepo.findOne({
      where: { bookingId, ownerId },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    if (
      booking.status !== BookingStatus.PENDING &&
      booking.status !== BookingStatus.ACCEPTED
    ) throw new BadRequestException('This booking cannot be cancelled');

    const hoursElapsed =
      (Date.now() - booking.createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursElapsed > 24) {
      throw new BadRequestException('Cancellation window has expired');
    }

    booking.status = BookingStatus.CANCELLED;
    await this.bookingRepo.save(booking);

    const provider = await this.providerRepo.findOne({ where: { id: booking.providerId } });
    if (provider) {
      await this.notificationsService.createNotification(
        provider.userId,
        'booking_cancelled',
        'Booking Cancelled',
        'A booking has been cancelled by the owner.',
        bookingId,
      );
    }

    const cancelCount = await this.bookingRepo.count({
      where: { ownerId, status: BookingStatus.CANCELLED },
    });

    if (cancelCount === 3) {
      const admins = await this.userRepo.find({ where: { role: 'admin' } });
      await Promise.all(
        admins.map((admin) =>
          this.notificationsService.createNotification(
            admin.id,
            'system',
            'User flagged for excessive cancellations',
            `Owner ${ownerId} has now cancelled ${cancelCount} bookings.`,
            ownerId,
          ),
        ),
      );
    }

    return booking;
  }
}
