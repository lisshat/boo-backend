import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Provider, VerificationStatus } from './providers.entity';
import { ProvidersService } from './providers.service';
import { User } from '../users/user.entity';

function queryBuilder<T>(result: T) {
  const qb: any = {
    innerJoin: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(result),
    getOne: jest.fn().mockResolvedValue(result),
  };
  return qb;
}

function makeService(overrides: Partial<Record<string, any>> = {}) {
  const providerRepo: any = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  };
  const serviceRepo: any = { findOne: jest.fn(), save: jest.fn() };
  const availabilityRepo: any = {
    find: jest.fn().mockResolvedValue([]),
    delete: jest.fn(),
    save: jest.fn(),
  };
  const userRepo: any = { findOne: jest.fn() };
  const bookingRepo: any = {};
  const streamService: any = {
    upsertStreamUser: jest.fn(),
    resolveOwnerProviderChannel: jest.fn(),
    createDirectChannel: jest.fn(),
  };
  const service = new ProvidersService(
    providerRepo,
    serviceRepo,
    availabilityRepo,
    userRepo,
    bookingRepo,
    streamService,
  );
  return { service, providerRepo, serviceRepo, availabilityRepo, userRepo, streamService, ...overrides };
}

describe('ProvidersService email activation boundary', () => {
  const confirmedProvider = {
    id: 'provider-1',
    userId: 'provider-user-1',
    businessName: 'Confirmed Care',
    verificationStatus: VerificationStatus.PENDING,
    isVerified: false,
    averageRating: 0,
    totalReviews: 0,
    latitude: -1.28,
    longitude: 36.82,
    services: [],
  } as any;

  it('filters discovery at the database query for unconfirmed providers', async () => {
    const { service, providerRepo } = makeService();
    const qb = queryBuilder([confirmedProvider]);
    providerRepo.createQueryBuilder.mockReturnValue(qb);

    await service.findAll();
    expect(qb.innerJoin).toHaveBeenCalledWith(
      User,
      'user',
      expect.stringContaining('user.email_verified_at IS NOT NULL'),
    );

    qb.getMany.mockResolvedValueOnce([]);
    expect(await service.findNearby(-1.28, 36.82, 25)).toEqual([]);
    expect(qb.innerJoin).toHaveBeenCalledWith(
      User,
      'user',
      expect.stringContaining('user.email_verified_at IS NOT NULL'),
    );
  });

  it('keeps a confirmed provider in discovery and hides an unconfirmed direct profile', async () => {
    const { service, providerRepo } = makeService();
    const confirmedQb = queryBuilder(confirmedProvider);
    providerRepo.createQueryBuilder.mockReturnValue(confirmedQb);
    await expect(service.findOne(confirmedProvider.id)).resolves.toMatchObject({
      id: confirmedProvider.id,
    });

    confirmedQb.getOne.mockResolvedValueOnce(null);
    await expect(service.findOne('unconfirmed-profile')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('leaves provider self-management available while email is unconfirmed', async () => {
    const { service, providerRepo, availabilityRepo } = makeService();
    const profile = { ...confirmedProvider };
    providerRepo.findOne.mockResolvedValue(profile);
    providerRepo.save.mockImplementation(async (value: any) => value);
    availabilityRepo.find.mockResolvedValue([]);

    await expect(
      service.updateByUserId('provider-user-1', { businessName: 'Draft Care' } as any),
    ).resolves.toMatchObject({ businessName: 'Draft Care' });
    await expect(service.getMyAvailability('provider-user-1')).resolves.toEqual([]);
  });

  it('rejects profile chat when the target provider email is unconfirmed', async () => {
    const { service, providerRepo, userRepo, streamService } = makeService();
    providerRepo.findOne.mockResolvedValue(confirmedProvider);
    userRepo.findOne.mockResolvedValue({
      id: confirmedProvider.userId,
      role: 'provider',
      isBanned: false,
      emailVerifiedAt: null,
    });

    await expect(service.initChatForProvider(confirmedProvider.id, 'owner-1'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(streamService.createDirectChannel).not.toHaveBeenCalled();
  });

  it('does not change provider KYC state when email confirmation is represented', () => {
    const provider = { ...confirmedProvider, verificationStatus: VerificationStatus.PENDING };
    const user = { emailVerifiedAt: new Date() };
    expect(provider.verificationStatus).toBe(VerificationStatus.PENDING);
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
  });
});
