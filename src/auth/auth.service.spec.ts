import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { AuthService } from './auth.service';
import { EmailVerificationCode } from './email-verification-code.entity';
import { PasswordResetCode } from './password-reset-code.entity';
import { User } from '../users/user.entity';

const verificationSecret = 'verification-test-secret';
const resetSecret = 'reset-test-secret';
const userId = '00000000-0000-4000-8000-000000000001';

function hmac(secret: string, input: string) {
  return createHmac('sha256', secret).update(input).digest('hex');
}

function makeService() {
  const usersRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const resetRepo = { update: jest.fn() };
  const verificationRepo = { update: jest.fn() };
  const providersRepo = { findOne: jest.fn() };
  const queryBuilder = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute: jest.fn(),
    addSelect: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };
  const manager = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(async (_entity: unknown, value: unknown) => value),
    create: jest.fn((_entity: unknown, value: unknown) => value),
    createQueryBuilder: jest.fn(() => queryBuilder),
    queryBuilder,
  };
  const dataSource = {
    transaction: jest.fn(async (callback: (value: typeof manager) => unknown) =>
      callback(manager),
    ),
  };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'EMAIL_VERIFICATION_SECRET') return verificationSecret;
      if (key === 'PASSWORD_RESET_SECRET') return resetSecret;
      if (key === 'JWT_SECRET' || key === 'JWT_REFRESH_SECRET') return 'jwt';
      return undefined;
    }),
  };
  const service = new AuthService(
    usersRepo as any,
    resetRepo as any,
    verificationRepo as any,
    providersRepo as any,
    { sign: jest.fn() } as any,
    config as any,
    {} as any,
    dataSource as any,
  );
  return {
    service,
    manager,
    dataSource,
    usersRepo,
    resetRepo,
    verificationRepo,
  };
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: userId,
    email: 'person@example.com',
    passwordHash: 'old-hash',
    fullName: 'Person',
    role: 'owner',
    isBanned: false,
    emailVerifiedAt: null,
    authVersion: 2,
    location: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as User;
}

function makeVerification(overrides: Partial<EmailVerificationCode> = {}) {
  return {
    verificationId: '00000000-0000-4000-8000-000000000002',
    userId,
    codeHash: hmac(verificationSecret, `${userId}:123456`),
    expiresAt: new Date(Date.now() + 60_000),
    failedAttempts: 0,
    consumedAt: null,
    lastSentAt: new Date(),
    deliveryFailedAt: null,
    createdAt: new Date(),
    ...overrides,
  } as EmailVerificationCode;
}

function makeReset(overrides: Partial<PasswordResetCode> = {}) {
  return {
    resetId: '00000000-0000-4000-8000-000000000003',
    userId,
    codeHash: hmac(resetSecret, `password-reset:${userId}:123456`),
    expiresAt: new Date(Date.now() + 60_000),
    failedAttempts: 0,
    consumedAt: null,
    lastSentAt: new Date(),
    deliveryFailedAt: null,
    createdAt: new Date(),
    ...overrides,
  } as PasswordResetCode;
}

function wireCodeLookup(
  manager: ReturnType<typeof makeService>['manager'],
  user: User,
  record: EmailVerificationCode | PasswordResetCode | null,
) {
  manager.queryBuilder.getOne.mockResolvedValue(user);
  manager.findOne.mockImplementation(async (entity: unknown) => {
    if (entity === User) return user;
    return record;
  });
}

describe('AuthService email confirmation persistence', () => {
  it('normalizes email addresses by trimming and lowercasing only', () => {
    const { service } = makeService();
    expect((service as any).normalizeEmail('  Person+Pets@Example.COM ')).toBe(
      'person+pets@example.com',
    );
  });

  it('keeps password-reset responses identical for existing and unknown emails', async () => {
    const { service, usersRepo, manager } = makeService();
    const user = makeUser();
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
    };
    usersRepo.createQueryBuilder.mockReturnValue(queryBuilder);
    (service as any).equalizePasswordResetTiming = jest.fn();
    (service as any).sendPasswordResetEmail = jest
      .fn()
      .mockResolvedValue(undefined);
    manager.findOne.mockResolvedValue(user);
    manager.find.mockResolvedValue([]);
    manager.create.mockReturnValue(makeReset());
    manager.save.mockResolvedValue(makeReset());

    queryBuilder.getOne.mockResolvedValueOnce(null);
    const unknown = await service.requestPasswordReset({
      email: 'unknown@example.com',
    });
    queryBuilder.getOne.mockResolvedValueOnce(user);
    const existing = await service.requestPasswordReset({
      email: ' PERSON@EXAMPLE.COM ',
    });

    expect(existing).toEqual(unknown);
    expect(existing).toEqual({
      message:
        'If an account exists for this email, a password reset code has been sent.',
    });
  });

  it('persists attempts 1 through 4 and consumes the code on attempt 5', async () => {
    const { service, manager } = makeService();
    const user = makeUser();
    const record = makeVerification();
    wireCodeLookup(manager, user, record);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(
        service.confirmEmailVerificationCode(userId, { code: '000000' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(record.failedAttempts).toBe(attempt);
      if (attempt < 5) expect(record.consumedAt).toBeNull();
    }
    expect(record.consumedAt).toBeInstanceOf(Date);
    expect(manager.save).toHaveBeenCalledTimes(5);
  });

  it('persists expired-code consumption and rejects consumed codes', async () => {
    const { service, manager } = makeService();
    const user = makeUser();
    const expired = makeVerification({ expiresAt: new Date(Date.now() - 1) });
    wireCodeLookup(manager, user, expired);

    await expect(
      service.confirmEmailVerificationCode(userId, { code: '123456' }),
    ).rejects.toThrow('expired');
    expect(expired.consumedAt).toBeInstanceOf(Date);

    manager.findOne.mockImplementation(async (entity: unknown) =>
      entity === User ? user : null,
    );
    await expect(
      service.confirmEmailVerificationCode(userId, { code: '123456' }),
    ).rejects.toThrow('No active confirmation code');
  });

  it('confirms once and makes the second confirmation a no-active-code response', async () => {
    const { service, manager } = makeService();
    const user = makeUser();
    const record = makeVerification();
    wireCodeLookup(manager, user, record);

    await expect(
      service.confirmEmailVerificationCode(userId, { code: '123456' }),
    ).resolves.toMatchObject({ emailVerified: true });
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    expect(record.consumedAt).toBeInstanceOf(Date);

    manager.findOne.mockImplementation(async (entity: unknown) =>
      entity === User ? user : null,
    );
    await expect(
      service.confirmEmailVerificationCode(userId, { code: '123456' }),
    ).resolves.toMatchObject({ emailVerified: true });
  });

  it('invalidates older codes and marks delivery failures unusable', async () => {
    const { service, manager, verificationRepo } = makeService();
    const user = makeUser();
    const saved = makeVerification();
    manager.findOne.mockResolvedValue(user);
    manager.find.mockResolvedValue([]);
    manager.create.mockReturnValue(saved);
    manager.save.mockResolvedValue(saved);
    (service as any).sendEmailVerificationEmail = jest
      .fn()
      .mockRejectedValue(new Error('provider'));
    await expect(service.sendEmailVerificationCode(userId)).rejects.toThrow(
      'could not send',
    );
    expect(manager.createQueryBuilder).toHaveBeenCalled();
    expect(verificationRepo.update).toHaveBeenCalledWith(
      saved.verificationId,
      expect.objectContaining({ deliveryFailedAt: expect.any(Date) }),
    );
  });

  it('enforces cooldown and the account hourly delivery limit from persisted records', async () => {
    const { service, manager } = makeService();
    const user = makeUser();
    manager.findOne.mockResolvedValue(user);
    const recent = Array.from({ length: 3 }, (_, index) =>
      makeVerification({
        createdAt: new Date(Date.now() - index * 60_000),
        lastSentAt: new Date(Date.now() - index * 60_000),
      }),
    );
    manager.find.mockResolvedValue(recent);
    await expect(
      service.sendEmailVerificationCode(userId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(manager.create).not.toHaveBeenCalled();
  });

  it('rejects the fourth successful delivery inside the persisted hourly window', async () => {
    const { service, manager } = makeService();
    const user = makeUser();
    manager.findOne.mockResolvedValue(user);
    const sentAt = new Date(Date.now() - 120_000);
    manager.find.mockResolvedValue(
      Array.from({ length: 3 }, () =>
        makeVerification({ createdAt: sentAt, lastSentAt: sentAt }),
      ),
    );
    await expect(
      service.sendEmailVerificationCode(userId),
    ).rejects.toMatchObject({
      response: { code: 'EMAIL_VERIFICATION_RATE_LIMITED' },
    });
    expect(manager.create).not.toHaveBeenCalled();
  });
});

describe('AuthService password recovery persistence', () => {
  it('persists incorrect attempts and consumes the reset code on attempt 5', async () => {
    const { service, manager } = makeService();
    const user = makeUser();
    const record = makeReset();
    wireCodeLookup(manager, user, record);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(
        service.confirmPasswordReset({
          email: ' PERSON@EXAMPLE.COM ',
          code: '000000',
          newPassword: 'new-password',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(record.failedAttempts).toBe(attempt);
    }
    expect(record.consumedAt).toBeInstanceOf(Date);
  });

  it('atomically changes the password, increments authVersion and consumes reset codes', async () => {
    const { service, manager } = makeService();
    const user = makeUser();
    const record = makeReset();
    wireCodeLookup(manager, user, record);
    await expect(
      service.confirmPasswordReset({
        email: ' PERSON@EXAMPLE.COM ',
        code: '123456',
        newPassword: 'new-password',
      }),
    ).resolves.toEqual({
      message: 'Password updated successfully. Please sign in again.',
    });
    expect(user.authVersion).toBe(3);
    expect(user.passwordHash).not.toBe('old-hash');
    expect(record.consumedAt).toBeInstanceOf(Date);
    expect(manager.createQueryBuilder).toHaveBeenCalled();
  });

  it('consumes expired reset codes before returning the controlled error', async () => {
    const { service, manager } = makeService();
    const user = makeUser();
    const record = makeReset({ expiresAt: new Date(Date.now() - 1) });
    wireCodeLookup(manager, user, record);
    await expect(
      service.confirmPasswordReset({
        email: 'person@example.com',
        code: '123456',
        newPassword: 'new-password',
      }),
    ).rejects.toThrow('expired');
    expect(record.consumedAt).toBeInstanceOf(Date);
  });
});
