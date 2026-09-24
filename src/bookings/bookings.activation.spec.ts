import { ForbiddenException } from '@nestjs/common';
import { BookingStatus } from './bookings.entity';
import { BookingsService } from './bookings.service';
import { Booking } from './bookings.entity';
import { Provider } from '../providers/providers.entity';
import { User } from '../users/user.entity';
import { ServiceOffering } from '../providers/service-offering.entity';

function lockQuery<T>(result: T) {
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(result),
  };
  return qb;
}

function makeService() {
  const bookingRepo: any = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    query: jest.fn(),
  };
  const providerRepo: any = { findOne: jest.fn() };
  const userRepo: any = { findOne: jest.fn() };
  const availabilityRepo: any = { findOne: jest.fn(), count: jest.fn() };
  const reviewRepo: any = { find: jest.fn() };
  const notificationsService: any = { createNotification: jest.fn() };
  const streamService: any = {
    upsertStreamUser: jest.fn(),
    resolveOwnerProviderChannel: jest.fn().mockResolvedValue('owner_provider'),
    createDirectChannel: jest.fn(),
  };
  const dataSource: any = { transaction: jest.fn() };
  const service = new BookingsService(
    bookingRepo,
    providerRepo,
    userRepo,
    availabilityRepo,
    reviewRepo,
    notificationsService,
    dataSource,
    streamService,
  );
  return {
    service,
    bookingRepo,
    providerRepo,
    userRepo,
    availabilityRepo,
    reviewRepo,
    notificationsService,
    dataSource,
    streamService,
  };
}

function futureBookingDate() {
  const value = new Date(Date.now() + 48 * 60 * 60 * 1000);
  value.setSeconds(0, 0);
  return value;
}

describe('provider email activation booking boundary', () => {
  const provider = {
    id: 'provider-1',
    userId: 'provider-user-1',
    verificationStatus: 'pending',
  } as any;
  const serviceOffering = {
    serviceId: 'service-1',
    provider,
    durationMinutes: 60,
    price: 500,
    pricingUnit: 'per_session',
  } as any;

  it('rejects booking creation for an unconfirmed provider inside the transaction', async () => {
    const { service, dataSource } = makeService();
    const providerLock = lockQuery(provider);
    const manager: any = {
      createQueryBuilder: jest.fn().mockReturnValue(providerLock),
      findOne: jest.fn().mockResolvedValue({
        id: provider.userId,
        role: 'provider',
        isBanned: false,
        emailVerifiedAt: null,
      }),
    };
    dataSource.transaction.mockImplementation((callback: any) => callback(manager));

    await expect(
      service.createBooking('owner-1', {
        providerId: provider.id,
        serviceId: serviceOffering.serviceId,
        bookingDatetime: futureBookingDate().toISOString(),
      } as any),
    ).rejects.toThrow('This provider is unavailable for new bookings');
    expect(providerLock.setLock).toHaveBeenCalledWith('pessimistic_write');
  });

  it('allows a confirmed eligible provider to receive a booking', async () => {
    const {
      service,
      dataSource,
      availabilityRepo,
      notificationsService,
      providerRepo,
    } = makeService();
    providerRepo.findOne.mockResolvedValue(provider);
    const providerLock = lockQuery(provider);
    const saved = { bookingId: 'booking-1', ownerId: 'owner-1', providerId: provider.id };
    const manager: any = {
      createQueryBuilder: jest.fn().mockReturnValue(providerLock),
      findOne: jest.fn((entity: any) => {
        if (entity === User) {
          return Promise.resolve({
            id: provider.userId,
            role: 'provider',
            isBanned: false,
            emailVerifiedAt: new Date(),
          });
        }
        if (entity === ServiceOffering) return Promise.resolve(serviceOffering);
        if (entity === Booking) return Promise.resolve(null);
        return Promise.resolve(null);
      }),
      getRepository: jest.fn().mockReturnValue(availabilityRepo),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockReturnValue(saved),
      save: jest.fn().mockResolvedValue(saved),
    };
    availabilityRepo.findOne.mockResolvedValue({
      profileId: provider.id,
      dayOfWeek: new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Nairobi',
        weekday: 'short',
      }).format(futureBookingDate()).replace(/^Sun$/, '0').replace(/^Mon$/, '1').replace(/^Tue$/, '2').replace(/^Wed$/, '3').replace(/^Thu$/, '4').replace(/^Fri$/, '5').replace(/^Sat$/, '6'),
      isAvailable: true,
      startTime: '00:00',
      endTime: '23:59',
    });
    availabilityRepo.count.mockResolvedValue(1);
    dataSource.transaction.mockImplementation((callback: any) => callback(manager));

    await expect(
      service.createBooking('owner-1', {
        providerId: provider.id,
        serviceId: serviceOffering.serviceId,
        bookingDatetime: futureBookingDate().toISOString(),
      } as any),
    ).resolves.toBe(saved);
    expect(notificationsService.createNotification).toHaveBeenCalled();
  });

  it('rejects acceptance by an unconfirmed provider before booking mutation', async () => {
    const { service, dataSource } = makeService();
    const providerLock = lockQuery(provider);
    const manager: any = {
      createQueryBuilder: jest.fn().mockReturnValue(providerLock),
      findOne: jest.fn().mockResolvedValue({
        id: provider.userId,
        role: 'provider',
        emailVerifiedAt: null,
      }),
    };
    dataSource.transaction.mockImplementation((callback: any) => callback(manager));

    await expect(service.acceptBooking('booking-1', provider.userId)).rejects.toThrow(
      'Confirm your email before accepting new bookings',
    );
    expect(manager.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(providerLock.setLock).toHaveBeenCalledWith('pessimistic_write');
  });

  it('accepts with a confirmed provider using row-only provider and booking locks', async () => {
    const { service, dataSource, availabilityRepo, notificationsService } = makeService();
    const providerLock = lockQuery(provider);
    const booking = {
      bookingId: 'booking-1',
      ownerId: 'owner-1',
      providerId: provider.id,
      serviceId: serviceOffering.serviceId,
      status: BookingStatus.PENDING,
      bookingDatetime: futureBookingDate(),
    } as any;
    const bookingLock = lockQuery(booking);
    const manager: any = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValueOnce(providerLock)
        .mockReturnValueOnce(bookingLock)
        .mockReturnValueOnce(lockQuery(serviceOffering)),
      findOne: jest.fn((entity: any) => {
        if (entity === User) return Promise.resolve({ emailVerifiedAt: new Date() });
        return Promise.resolve(null);
      }),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation(async (_entity: any, value: any) => value),
    };
    dataSource.transaction.mockImplementation((callback: any) => callback(manager));

    // The service lookup is a row-only query after the locked booking reload.
    const serviceQuery = lockQuery(serviceOffering);
    manager.createQueryBuilder.mockReset();
    manager.createQueryBuilder
      .mockReturnValueOnce(providerLock)
      .mockReturnValueOnce(bookingLock)
      .mockReturnValueOnce(serviceQuery);
    serviceQuery.getOne.mockResolvedValue(serviceOffering);
    availabilityRepo.findOne.mockResolvedValue({});
    await expect(service.acceptBooking(booking.bookingId, provider.userId)).resolves.toBe(
      booking,
    );
    expect(providerLock.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(bookingLock.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(notificationsService.createNotification).toHaveBeenCalled();
  });

  it('keeps existing accepted booking chat available for an unconfirmed provider', async () => {
    const { service, bookingRepo, userRepo, streamService } = makeService();
    const owner = { id: 'owner-1', fullName: 'Owner', role: 'owner' } as any;
    bookingRepo.findOne.mockResolvedValue({
      bookingId: 'booking-1',
      status: BookingStatus.ACCEPTED,
      provider: { ...provider },
      owner,
    });
    userRepo.findOne.mockResolvedValue({
      id: provider.userId,
      fullName: 'Provider',
      role: 'provider',
    });

    await expect(service.initChatForBooking('booking-1', provider.userId)).resolves.toEqual({
      channelId: 'owner_provider',
      channelType: 'messaging',
    });
    expect(streamService.createDirectChannel).toHaveBeenCalled();
  });

  it('keeps accepted booking history readable without public provider lookup', async () => {
    const { service, bookingRepo, reviewRepo } = makeService();
    const booking = {
      bookingId: 'booking-1',
      ownerId: 'owner-1',
      provider: { ...provider },
      status: BookingStatus.ACCEPTED,
    } as any;
    bookingRepo.find.mockResolvedValue([booking]);
    reviewRepo.find.mockResolvedValue([]);

    await expect(service.getBookings('owner-1')).resolves.toEqual([
      expect.objectContaining({ bookingId: 'booking-1', hasReview: false }),
    ]);
  });
});
