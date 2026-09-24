import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  DataSource,
  EntityManager,
  In,
  IsNull,
  Repository,
} from 'typeorm';
import {
  Booking,
  BookingStatus,
  PaymentMethod,
  PaymentStatus,
} from './bookings.entity';
import { Provider } from '../providers/providers.entity';
import { User } from '../users/user.entity';
import { ProviderAvailability } from '../providers/provider-availability.entity';
import { Review } from '../reviews/review.entity';
import { Pet } from '../pets/pet.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { ServiceOffering } from '../providers/service-offering.entity';
import { bookingInterval, intervalsOverlap } from './booking-interval';
import { StreamService } from '../stream/stream.service';
import { NotificationType } from '../notifications/notification.entity';

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
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
    private readonly notificationsService: NotificationsService,
    private readonly dataSource: DataSource,
    private readonly streamService: StreamService,
  ) {}

  private agreedAmount(
    price: number,
    pricingUnit: string,
    durationMinutes: number,
  ): number {
    const normalized = pricingUnit?.trim().toLowerCase() ?? 'per_session';
    const multiplier =
      normalized === 'per_hour'
        ? durationMinutes / 60
        : normalized === 'per_day' || normalized === 'per_night'
          ? durationMinutes / 1440
          : 1;
    return Number((Number(price) * multiplier).toFixed(2));
  }

  private appTimeZone(): string {
    // Kenya MVP default; deployments may override with APP_TIMEZONE.
    return process.env.APP_TIMEZONE?.trim() || 'Africa/Nairobi';
  }

  private localParts(value: Date) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.appTimeZone(),
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(value);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? '';
    const weekdays: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return {
      day: weekdays[get('weekday')],
      time: `${get('hour')}:${get('minute')}`,
    };
  }

  private async validateAvailability(
    providerId: string,
    bookingDatetime: Date,
    durationMinutes: number,
    availabilityRepo: Repository<ProviderAvailability> = this.availabilityRepo,
  ): Promise<void> {
    const interval = bookingInterval(bookingDatetime, {
      durationMinutes,
    } as any);
    const localStart = this.localParts(interval.start);
    const localEnd = this.localParts(interval.end);
    const dayOfWeek = localStart.day;
    const bookingTime = localStart.time;

    const availability = await availabilityRepo.findOne({
      where: { profileId: providerId, dayOfWeek, isAvailable: true },
    });

    if (!availability) {
      const hasAny = await availabilityRepo.count({
        where: { profileId: providerId },
      });
      if (hasAny === 0) {
        throw new ConflictException(
          'This provider has not configured availability yet. Please choose another provider or try again later.',
        );
      }
      throw new BadRequestException(
        'The provider is not available on this day. Please choose another date.',
      );
    }

    const startTime = availability.startTime.substring(0, 5);
    const endTime = availability.endTime.substring(0, 5);

    if (
      localEnd.day !== dayOfWeek ||
      bookingTime < startTime ||
      localEnd.time > endTime
    ) {
      throw new BadRequestException(
        `Provider is only available between ${startTime} and ${endTime} on this day.`,
      );
    }
  }

  async createBooking(
    ownerId: string,
    dto: CreateBookingDto,
  ): Promise<Booking> {
    const bookingDatetime = new Date(dto.bookingDatetime);
    if (!Number.isFinite(bookingDatetime.getTime()))
      throw new BadRequestException('Invalid booking timestamp');
    bookingDatetime.setSeconds(0, 0);

    if (bookingDatetime <= new Date())
      throw new BadRequestException('Cannot book a time slot in the past');

    let created!: Booking;
    let duplicateFound = false;
    await this.dataSource.transaction(async (manager) => {
      const provider = await manager
        .createQueryBuilder(Provider, 'provider')
        .where('provider.profile_id = :providerId', {
          providerId: dto.providerId,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (!provider) throw new NotFoundException('Provider not found');
      const providerUser = await manager.findOne(User, {
        where: { id: provider.userId },
      });
      if (
        !providerUser ||
        providerUser.isBanned ||
        !providerUser.emailVerifiedAt ||
        providerUser.role !== 'provider' ||
        provider.verificationStatus === 'rejected'
      ) {
        throw new ForbiddenException(
          'This provider is unavailable for new bookings',
        );
      }
      const service = await manager.findOne(ServiceOffering, {
        where: { serviceId: dto.serviceId },
        relations: ['provider'],
      });
      if (!service || service.provider?.id !== provider.id)
        throw new BadRequestException(
          'Service does not belong to this provider',
        );
      if (dto.petId) {
        const pet = await manager.findOne(Pet, {
          where: { petId: dto.petId, ownerId },
        });
        if (!pet) throw new NotFoundException('Pet not found');
      }
      await this.validateAvailability(
        dto.providerId,
        bookingDatetime,
        service.durationMinutes,
        manager.getRepository(ProviderAvailability),
      );
      const duplicate = await manager.findOne(Booking, {
        where: {
          ownerId,
          providerId: dto.providerId,
          serviceId: dto.serviceId,
          bookingDatetime,
          status: In([BookingStatus.PENDING, BookingStatus.ACCEPTED]),
        },
      });
      if (duplicate) {
        created = duplicate;
        duplicateFound = true;
        return;
      }
      const booking = manager.create(Booking, {
        ownerId,
        providerId: dto.providerId,
        serviceId: dto.serviceId,
        petId: dto.petId ?? null,
        bookingDatetime,
        notes: dto.notes ?? null,
        status: BookingStatus.PENDING,
        agreedAmount: this.agreedAmount(
          Number(service.price),
          service.pricingUnit,
          service.durationMinutes,
        ),
        currency: 'KES',
        pricingUnitSnapshot: service.pricingUnit,
        durationMinutesSnapshot: service.durationMinutes,
        snapshotSource: 'booking_time',
        paymentStatus: PaymentStatus.NOT_RECORDED,
        paymentMethod: null,
        paidAt: null,
        providerRecordedAt: null,
        paymentRecordReversedAt: null,
      });
      created = await manager.save(Booking, booking);
    });

    const provider = await this.providerRepo.findOne({
      where: { id: dto.providerId },
    });
    if (provider && !duplicateFound) {
      await this.notificationsService.createNotification(
        provider.userId,
        NotificationType.BOOKING_REQUEST,
        'New Booking Request',
        'You have a new booking request.',
        created!.bookingId,
      );
    }

    return created!;
  }

  async getBookings(
    ownerId: string,
  ): Promise<
    (Booking & { hasReview: boolean; reviewRating: number | null })[]
  > {
    const [bookings, reviews] = await Promise.all([
      this.bookingRepo.find({
        where: { ownerId },
        relations: ['provider', 'service'],
        order: { createdAt: 'DESC' },
      }),
      this.reviewRepo.find({ where: { ownerId } }),
    ]);

    const reviewMap = new Map(reviews.map((r) => [r.bookingId, r.rating]));

    return bookings.map((b) => ({
      ...b,
      hasReview: reviewMap.has(b.bookingId),
      reviewRating: reviewMap.get(b.bookingId) ?? null,
    }));
  }

  async getProviderBookings(userId: string): Promise<any[]> {
    const provider = await this.providerRepo.findOne({ where: { userId } });
    if (!provider) throw new NotFoundException('Provider profile not found');
    const bookings = await this.bookingRepo.find({
      where: { providerId: provider.id },
      relations: ['service', 'owner'],
      order: { createdAt: 'DESC' },
    });
    return bookings.map(({ owner, ...booking }) => ({
      ...booking,
      owner: owner ? { id: owner.id, fullName: owner.fullName } : null,
    }));
  }

  async initChatForBooking(
    bookingId: string,
    requesterId: string,
  ): Promise<{ channelId: string; channelType: 'messaging' }> {
    const booking = await this.bookingRepo.findOne({
      where: { bookingId },
      relations: ['provider', 'owner'],
    });
    if (!booking) throw new NotFoundException('Booking not found');
    const providerUser = await this.userRepo.findOne({
      where: { id: booking.provider.userId },
    });
    if (!providerUser || providerUser.id !== requesterId)
      throw new NotFoundException('Booking not found');
    if (booking.status !== BookingStatus.ACCEPTED)
      throw new ForbiddenException(
        'Provider chat is available for accepted bookings only',
      );
    const owner = booking.owner;
    if (!owner) throw new NotFoundException('Booking owner not found');
    const memberIds = [providerUser.id, owner.id].sort();
    await this.streamService.upsertStreamUser(
      providerUser.id,
      providerUser.fullName,
      providerUser.role,
    );
    await this.streamService.upsertStreamUser(
      owner.id,
      owner.fullName,
      owner.role,
    );
    const channelId = await this.streamService.resolveOwnerProviderChannel(
      providerUser.id,
      owner.id,
    );
    await this.streamService.createDirectChannel(
      channelId,
      memberIds,
      providerUser.id,
      {
        providerProfileId: booking.provider.id,
        providerVerificationStatus: booking.provider.verificationStatus,
      },
    );
    return { channelId, channelType: 'messaging' };
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
        b.payment_status,
        b.payment_method,
        b.paid_at,
        b.provider_recorded_at,
        b.agreed_amount,
        b.currency,
        b.pricing_unit_snapshot,
        b.duration_minutes_snapshot,
        b.snapshot_source,
        s.service_name,
        s.category,
        u.full_name         AS owner_name
      FROM bookings b
      LEFT JOIN services s ON s.service_id = b.service_id
      JOIN users u ON u.id = b.owner_id
      WHERE b.provider_id = $1
        AND b.status IN ('completed', 'accepted', 'pending')
      ORDER BY b.booking_datetime DESC
      `,
      [provider.id],
    );

    const completed = rows.filter((r) => r.status === 'completed');
    const valuedCompleted = completed.filter((r) => r.agreed_amount != null);
    const recorded = completed.filter(
      (r) =>
        r.payment_status === PaymentStatus.PROVIDER_RECORDED_RECEIVED &&
        r.agreed_amount != null,
    );
    const totalEarnings = valuedCompleted.reduce(
      (sum, r) => sum + Number(r.agreed_amount ?? 0),
      0,
    );
    const recordedEarnings = recorded.reduce(
      (sum, r) => sum + Number(r.agreed_amount ?? 0),
      0,
    );

    const byCategory: Record<string, number> = {};
    for (const r of recorded) {
      const cat = (r.category as string) ?? 'other';
      byCategory[cat] = (byCategory[cat] ?? 0) + Number(r.agreed_amount ?? 0);
    }

    const byMonth: Record<string, number> = {};
    for (const r of recorded) {
      const dt = new Date(r.booking_datetime as string);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      byMonth[key] = (byMonth[key] ?? 0) + Number(r.agreed_amount ?? 0);
    }

    return {
      summary: {
        totalEarnings: parseFloat(recordedEarnings.toFixed(2)),
        completedServiceValue: parseFloat(totalEarnings.toFixed(2)),
        completedCount: completed.length,
        completedMissingSnapshotCount:
          completed.length - valuedCompleted.length,
        completedUnrecordedCount: completed.filter(
          (r) => r.payment_status !== PaymentStatus.PROVIDER_RECORDED_RECEIVED,
        ).length,
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
        price: Number(r.agreed_amount ?? 0),
        amount: Number(r.agreed_amount ?? 0),
        currency: r.currency,
        pricingUnit: r.pricing_unit_snapshot,
        durationMinutes: r.duration_minutes_snapshot,
        paymentStatus: r.payment_status,
        paymentMethod: r.payment_method,
        paidAt: r.paid_at,
        providerRecordedAt: r.provider_recorded_at,
        snapshotSource: r.snapshot_source,
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
    todayBookings: any[];
  }> {
    const provider = await this.providerRepo.findOne({ where: { userId } });
    if (!provider) throw new NotFoundException('Provider profile not found');

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const [todayCount, pendingCount, totalCompleted, todayBookings] =
      await Promise.all([
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

    const safeTodayBookings = todayBookings.map(({ owner, ...booking }) => ({
      ...booking,
      owner: owner ? { id: owner.id, fullName: owner.fullName } : null,
    }));
    return {
      todayCount,
      pendingCount,
      totalCompleted,
      todayBookings: safeTodayBookings,
    };
  }

  async acceptBooking(bookingId: string, userId: string): Promise<Booking> {
    let booking!: Booking;
    await this.dataSource.transaction(async (manager) => {
      const provider = await manager
        .createQueryBuilder(Provider, 'provider')
        .where('provider.user_id = :userId', { userId })
        .setLock('pessimistic_write')
        .getOne();
      if (!provider) throw new NotFoundException('Provider profile not found');
      const providerUser = await manager.findOne(User, {
        where: { id: provider.userId },
      });
      if (!providerUser?.emailVerifiedAt) {
        throw new ForbiddenException(
          'Confirm your email before accepting new bookings',
        );
      }
      const target = await manager
        .createQueryBuilder(Booking, 'booking')
        .where('booking.booking_id = :bookingId', { bookingId })
        .andWhere('booking.provider_id = :providerId', {
          providerId: provider.id,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (!target) throw new NotFoundException('Booking not found');
      if (target.providerId !== provider.id)
        throw new BadRequestException(
          'Booking does not belong to this provider',
        );
      if (target.status !== BookingStatus.PENDING)
        throw new BadRequestException('Only pending bookings can be accepted');
      const service = await manager
        .createQueryBuilder(ServiceOffering, 'service')
        .where('service.service_id = :serviceId', {
          serviceId: target.serviceId,
        })
        .andWhere('service.profile_id = :providerId', {
          providerId: provider.id,
        })
        .getOne();
      if (!service)
        throw new BadRequestException('Booking service is unavailable');
      target.service = service;
      const candidate = bookingInterval(target.bookingDatetime, service);
      const accepted = await manager.find(Booking, {
        where: { providerId: provider.id, status: BookingStatus.ACCEPTED },
        relations: ['service'],
      });
      for (const existing of accepted) {
        if (
          intervalsOverlap(
            candidate,
            bookingInterval(existing.bookingDatetime, existing.service),
          )
        )
          throw new ConflictException(
            'This booking overlaps an accepted booking for the provider',
          );
      }
      target.status = BookingStatus.ACCEPTED;
      booking = await manager.save(Booking, target);
    });

    await this.notificationsService.createNotification(
      booking!.ownerId,
      NotificationType.BOOKING_ACCEPTED,
      'Booking Confirmed',
      'Your booking has been accepted.',
      booking!.bookingId,
    );

    return booking!;
  }

  async declineBooking(
    bookingId: string,
    userId: string,
    reason?: string,
  ): Promise<Booking> {
    const normalizedReason = reason?.trim() ?? '';
    if (normalizedReason.length < 3 || normalizedReason.length > 500) {
      throw new BadRequestException(
        'Decline reason must be between 3 and 500 characters',
      );
    }
    const provider = await this.providerRepo.findOne({ where: { userId } });
    if (!provider) throw new NotFoundException('Provider profile not found');
    const booking = await this.bookingRepo.findOne({
      where: { bookingId, providerId: provider.id },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== BookingStatus.PENDING)
      throw new BadRequestException('Only pending bookings can be declined');
    booking.status = BookingStatus.DECLINED;
    booking.declineReason = normalizedReason;
    await this.bookingRepo.save(booking);

    const reasonText = ` Reason: ${normalizedReason}`;
    await this.notificationsService.createNotification(
      booking.ownerId,
      NotificationType.BOOKING_DECLINED,
      'Booking Declined',
      `Your booking was declined by the provider.${reasonText}`,
      bookingId,
    );

    // Track unreasoned declines and warn at thresholds
    const unreasonedCount = await this.bookingRepo.count({
      where: {
        providerId: booking.providerId,
        status: BookingStatus.DECLINED,
        declineReason: IsNull(),
      },
    });

    if (unreasonedCount >= 5) {
      const admins = await this.userRepo.find({ where: { role: 'admin' } });
      await Promise.all(
        admins.map((admin) =>
          this.notificationsService.createNotification(
            admin.id,
            NotificationType.SYSTEM,
            'Provider flagged — high unreasoned declines',
            `${provider.businessName} has declined ${unreasonedCount} bookings without providing a reason. Review recommended.`,
            booking.bookingId,
          ),
        ),
      );
    } else if (unreasonedCount === 3) {
      await this.notificationsService.createNotification(
        provider.userId,
        NotificationType.SYSTEM,
        'Reminder: Please explain booking declines',
        'You have declined 3 bookings without providing a reason. Owners appreciate knowing why — and repeated unexplained declines may lead to account review.',
        booking.bookingId,
      );
    }

    return booking;
  }

  private async transitionAcceptedBooking(
    manager: EntityManager,
    bookingId: string,
    providerId: string,
    gracePeriodMs: number,
    throwIfNotDue: boolean,
  ): Promise<Booking | null> {
    const booking = await manager
      .createQueryBuilder(Booking, 'booking')
      .where('booking.booking_id = :bookingId', { bookingId })
      .andWhere('booking.provider_id = :providerId', { providerId })
      .setLock('pessimistic_write')
      .getOne();
    if (!booking) {
      if (throwIfNotDue) throw new NotFoundException('Booking not found');
      return null;
    }
    if (booking.status !== BookingStatus.ACCEPTED) {
      if (throwIfNotDue) {
        throw new BadRequestException(
          'Only accepted bookings can be marked complete',
        );
      }
      return null;
    }

    // Load the service separately.  Locking a booking together with its
    // nullable service relation makes PostgreSQL reject FOR UPDATE on the
    // nullable side of the generated outer join.
    const service = await manager.findOne(ServiceOffering, {
      where: { serviceId: booking.serviceId },
    });
    if (!service) {
      if (throwIfNotDue) {
        throw new BadRequestException('Booking service is unavailable');
      }
      return null;
    }

    const serviceEnd = bookingInterval(booking.bookingDatetime, service).end;
    const dueAt = new Date(serviceEnd.getTime() + gracePeriodMs);
    if (new Date() < dueAt) {
      if (throwIfNotDue) {
        throw new BadRequestException(
          'Cannot complete a booking before the service duration has elapsed',
        );
      }
      return null;
    }

    booking.status = BookingStatus.COMPLETED;
    return manager.save(Booking, booking);
  }

  async completeBooking(bookingId: string, userId: string): Promise<Booking> {
    const completedBooking = await this.dataSource.transaction(
      async (manager) => {
        const provider = await manager
          .createQueryBuilder(Provider, 'provider')
          .where('provider.user_id = :userId', { userId })
          .setLock('pessimistic_write')
          .getOne();
        if (!provider)
          throw new NotFoundException('Provider profile not found');
        const completed = await this.transitionAcceptedBooking(
          manager,
          bookingId,
          provider.id,
          0,
          true,
        );
        if (!completed) {
          throw new BadRequestException(
            'Only accepted bookings can be marked complete',
          );
        }
        return completed;
      },
    );

    await this.notificationsService.createNotification(
      completedBooking.ownerId,
      NotificationType.BOOKING_COMPLETED,
      'Service Complete',
      'Your booking is complete! How did it go?',
      bookingId,
    );

    return completedBooking;
  }

  async completeBookingAutomatically(
    bookingId: string,
    providerId: string,
  ): Promise<boolean> {
    const completedBooking = await this.dataSource.transaction(
      async (manager) => {
        // Lock the provider before the booking to serialize with acceptance and
        // manual completion across concurrent workers.
        const provider = await manager
          .createQueryBuilder(Provider, 'provider')
          .where('provider.profile_id = :providerId', { providerId })
          .setLock('pessimistic_write')
          .getOne();
        if (!provider) return null;
        return this.transitionAcceptedBooking(
          manager,
          bookingId,
          provider.id,
          24 * 60 * 60 * 1000,
          false,
        );
      },
    );

    if (!completedBooking) return false;
    await this.notificationsService.createNotification(
      completedBooking.ownerId,
      NotificationType.BOOKING_COMPLETED,
      'Service Complete',
      'Your booking is complete! How did it go?',
      completedBooking.bookingId,
    );
    return true;
  }

  async recordPayment(
    bookingId: string,
    userId: string,
    received: boolean,
    paymentMethod?: string,
  ): Promise<Booking> {
    return this.dataSource.transaction(async (manager) => {
      const provider = await manager
        .createQueryBuilder(Provider, 'provider')
        .where('provider.user_id = :userId', { userId })
        .setLock('pessimistic_write')
        .getOne();
      if (!provider) throw new NotFoundException('Provider profile not found');

      const booking = await manager
        .createQueryBuilder(Booking, 'booking')
        .where('booking.booking_id = :bookingId', { bookingId })
        .andWhere('booking.provider_id = :providerId', {
          providerId: provider.id,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (!booking) throw new NotFoundException('Booking not found');
      if (booking.status !== BookingStatus.COMPLETED) {
        throw new BadRequestException(
          'Payment can only be recorded after the booking is completed',
        );
      }

      if (!received) {
        if (booking.paymentStatus === PaymentStatus.NOT_RECORDED)
          return booking;
        booking.paymentStatus = PaymentStatus.NOT_RECORDED;
        booking.paymentMethod = null;
        booking.paidAt = null;
        booking.paymentRecordReversedAt = new Date();
        return manager.save(Booking, booking);
      }

      if (!paymentMethod) {
        throw new BadRequestException('Choose how the payment was received');
      }
      if (
        booking.paymentStatus === PaymentStatus.PROVIDER_RECORDED_RECEIVED &&
        booking.paymentMethod === paymentMethod
      ) {
        return booking;
      }
      booking.paymentStatus = PaymentStatus.PROVIDER_RECORDED_RECEIVED;
      booking.paymentMethod = paymentMethod as PaymentMethod;
      booking.paidAt = new Date();
      booking.providerRecordedAt = new Date();
      booking.paymentRecordReversedAt = null;
      return manager.save(Booking, booking);
    });
  }

  async rescheduleBooking(
    bookingId: string,
    ownerId: string,
    newDatetime: string,
  ): Promise<Booking> {
    const newDt = new Date(newDatetime);
    if (!Number.isFinite(newDt.getTime())) {
      throw new BadRequestException('Invalid booking timestamp');
    }
    newDt.setSeconds(0, 0);
    if (newDt <= new Date()) {
      throw new BadRequestException('New datetime must be in the future');
    }
    const fmt = (d: Date) => {
      const months = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ];
      const h = d.getUTCHours() % 12 || 12;
      const m = d.getUTCMinutes().toString().padStart(2, '0');
      const p = d.getUTCHours() >= 12 ? 'PM' : 'AM';
      return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${h}:${m} ${p}`;
    };
    let newBooking!: Booking;
    let providerUserId: string | null = null;
    let oldDatetime!: Date;
    let serviceName = 'your service';
    await this.dataSource.transaction(async (manager) => {
      const original = await manager
        .createQueryBuilder(Booking, 'booking')
        .where('booking.booking_id = :bookingId', { bookingId })
        .andWhere('booking.owner_id = :ownerId', { ownerId })
        .getOne();
      if (!original) throw new NotFoundException('Booking not found');

      const provider = await manager
        .createQueryBuilder(Provider, 'provider')
        .where('provider.profile_id = :providerId', {
          providerId: original.providerId,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (!provider) throw new NotFoundException('Provider not found');

      const booking = await manager
        .createQueryBuilder(Booking, 'booking')
        .where('booking.booking_id = :bookingId', { bookingId })
        .andWhere('booking.owner_id = :ownerId', { ownerId })
        .andWhere('booking.provider_id = :providerId', {
          providerId: provider.id,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (!booking) throw new NotFoundException('Booking not found');
      if (booking.ownerId !== ownerId)
        throw new ForbiddenException('You do not own this booking');
      if (booking.providerId !== provider.id)
        throw new BadRequestException('Booking provider does not match');
      if (
        booking.status !== BookingStatus.PENDING &&
        booking.status !== BookingStatus.ACCEPTED
      ) {
        throw new BadRequestException(
          'Only pending or accepted bookings can be rescheduled',
        );
      }

      if (!booking.serviceId)
        throw new BadRequestException('Booking service is unavailable');
      const service = await manager
        .createQueryBuilder(ServiceOffering, 'service')
        .where('service.service_id = :serviceId', {
          serviceId: booking.serviceId,
        })
        .andWhere('service.profile_id = :providerId', {
          providerId: provider.id,
        })
        .getOne();
      if (!service)
        throw new BadRequestException('Booking service is unavailable');
      booking.service = service;
      const duration = service.durationMinutes;
      bookingInterval(newDt, service);
      await this.validateAvailability(
        provider.id,
        newDt,
        Number(duration),
        manager.getRepository(ProviderAvailability),
      );

      oldDatetime = booking.bookingDatetime;
      serviceName = service.serviceName;
      providerUserId = provider.userId;
      booking.status = BookingStatus.RESCHEDULED;
      await manager.save(Booking, booking);

      newBooking = manager.create(Booking, {
        ownerId: booking.ownerId,
        providerId: booking.providerId,
        serviceId: booking.serviceId,
        petId: booking.petId,
        bookingDatetime: newDt,
        status: BookingStatus.PENDING,
        rescheduledFrom: booking.bookingId,
        notes: `Rescheduled from ${fmt(oldDatetime)}`,
        agreedAmount: booking.agreedAmount,
        currency: booking.currency,
        pricingUnitSnapshot: booking.pricingUnitSnapshot,
        durationMinutesSnapshot: booking.durationMinutesSnapshot,
        snapshotSource: booking.snapshotSource,
        paymentStatus: PaymentStatus.NOT_RECORDED,
        paymentMethod: null,
        paidAt: null,
        providerRecordedAt: null,
        paymentRecordReversedAt: null,
      });
      newBooking = await manager.save(Booking, newBooking);
    });

    const owner = await this.userRepo.findOne({ where: { id: ownerId } });
    const ownerName = owner?.fullName ?? 'A pet owner';
    if (providerUserId) {
      await this.notificationsService.createNotification(
        providerUserId,
        NotificationType.BOOKING_RESCHEDULED,
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
    )
      throw new BadRequestException('This booking cannot be cancelled');

    const hoursElapsed =
      (Date.now() - booking.createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursElapsed > 24) {
      throw new BadRequestException('Cancellation window has expired');
    }

    booking.status = BookingStatus.CANCELLED;
    await this.bookingRepo.save(booking);

    const provider = await this.providerRepo.findOne({
      where: { id: booking.providerId },
    });
    if (provider) {
      await this.notificationsService.createNotification(
        provider.userId,
        NotificationType.BOOKING_CANCELLED,
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
            NotificationType.SYSTEM,
            'User flagged for excessive cancellations',
            `An owner has now cancelled ${cancelCount} bookings. Review recommended.`,
            booking.bookingId,
          ),
        ),
      );
    }

    return booking;
  }
}
