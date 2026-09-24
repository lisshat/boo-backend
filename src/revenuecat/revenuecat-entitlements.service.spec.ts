import { UnauthorizedException } from '@nestjs/common';
import { RevenueCatEntitlementsService } from './revenuecat-entitlements.service';
import { User } from '../users/user.entity';
import { RevenueCatWebhookEvent } from './revenuecat-webhook-event.entity';
import { UserEntitlement } from './user-entitlement.entity';

const ownerId = '00000000-0000-4000-8000-000000000001';
const authToken = 'webhook-test-token';

function harness(
  options: {
    existingEvent?: unknown;
    entitlement?: unknown;
    role?: string;
  } = {},
) {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'REVENUECAT_WEBHOOK_AUTH_TOKEN') return authToken;
      if (key === 'REVENUECAT_ALLOW_TEST_STORE') return 'false';
      return undefined;
    }),
  };
  const user = { id: ownerId, role: options.role ?? 'owner' } as User;
  const userQuery = {
    where: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(user),
  };
  const entitlementQuery = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(options.entitlement ?? null),
  };
  const saved: unknown[] = [];
  const manager = {
    findOne: jest.fn().mockResolvedValue(options.existingEvent ?? null),
    create: jest.fn((_entity: unknown, value: unknown) => value),
    save: jest.fn(async (value: unknown) => {
      saved.push(value);
      return value;
    }),
    getRepository: jest.fn((entity: unknown) => {
      if (entity === User) return { createQueryBuilder: () => userQuery };
      return { createQueryBuilder: () => entitlementQuery };
    }),
  };
  const dataSource = {
    transaction: jest.fn(async (callback: (value: typeof manager) => unknown) =>
      callback(manager),
    ),
  };
  const userRepo = { findOne: jest.fn().mockResolvedValue(user) };
  const eventRepo = { insert: jest.fn() };
  const service = new RevenueCatEntitlementsService(
    config as any,
    dataSource as any,
    userRepo as any,
    eventRepo as any,
  );
  return {
    service,
    manager,
    userQuery,
    entitlementQuery,
    saved,
    config,
    userRepo,
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    event: {
      id: 'evt-1',
      type: 'INITIAL_PURCHASE',
      app_user_id: ownerId,
      entitlement_ids: ['boo_plus'],
      event_timestamp_ms: Date.parse('2026-09-24T10:00:00Z'),
      expiration_at_ms: Date.parse('2026-10-24T10:00:00Z'),
      product_id: 'boo_plus_monthly',
      environment: 'PRODUCTION',
      ...overrides,
    },
  };
}

describe('RevenueCat entitlement projection', () => {
  it('rejects missing and incorrect webhook credentials', async () => {
    const { service } = harness();
    await expect(
      service.processWebhook(undefined, payload()),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.processWebhook('wrong', payload()),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('projects a valid owner Boo Plus purchase and locks user before entitlement', async () => {
    const { service, manager, userQuery, entitlementQuery, saved } = harness();
    const result = await service.processWebhook(authToken, payload());
    expect(result).toEqual({ accepted: true, category: 'applied' });
    expect(saved.some((value: any) => value.entitlementId === 'boo_plus')).toBe(
      true,
    );
    expect(userQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(entitlementQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(manager.getRepository).toHaveBeenCalledWith(User);
    expect(manager.getRepository).toHaveBeenCalledWith(UserEntitlement);
  });

  it('does not apply a duplicate event twice', async () => {
    const { service, manager } = harness({
      existingEvent: { eventId: 'evt-1' },
    });
    await expect(service.processWebhook(authToken, payload())).resolves.toEqual(
      {
        accepted: true,
        category: 'duplicate',
      },
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rejects a role-mismatched entitlement without activating it', async () => {
    const { service, saved } = harness({ role: 'provider' });
    await expect(service.processWebhook(authToken, payload())).resolves.toEqual(
      {
        accepted: true,
        category: 'role_mismatch',
      },
    );
    expect(saved.some((value: any) => value.entitlementId === 'boo_plus')).toBe(
      false,
    );
  });

  it('does not resolve anonymous or unknown identities to a Boo user', async () => {
    const h = harness();
    (h.service as any).userRepo.findOne.mockResolvedValue(null);
    await expect(
      h.service.processWebhook(
        authToken,
        payload({ app_user_id: '$RCAnonymousID:abc' }),
      ),
    ).resolves.toEqual({ accepted: true, category: 'unresolved_identity' });
  });

  it('fails closed when webhook configuration is missing', async () => {
    const h = harness();
    h.config.get.mockReturnValue(undefined);
    await expect(
      h.service.processWebhook(authToken, payload()),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects Test Store events unless explicitly enabled', async () => {
    const h = harness();
    await expect(
      h.service.processWebhook(authToken, payload({ environment: 'SANDBOX' })),
    ).resolves.toEqual({ accepted: true, category: 'test_store_rejected' });
  });

  it('accepts a Test Store event only when explicitly enabled', async () => {
    const h = harness();
    h.config.get.mockImplementation((key: string) => {
      if (key === 'REVENUECAT_WEBHOOK_AUTH_TOKEN') return authToken;
      if (key === 'REVENUECAT_ALLOW_TEST_STORE') return 'true';
      return undefined;
    });
    await expect(
      h.service.processWebhook(authToken, payload({ environment: 'SANDBOX' })),
    ).resolves.toEqual({ accepted: true, category: 'applied' });
  });

  it('resolves a valid UUID alias and ignores an unknown entitlement', async () => {
    const h = harness();
    await expect(
      h.service.processWebhook(
        authToken,
        payload({
          app_user_id: '$RCAnonymousID:abc',
          aliases: [ownerId],
          entitlement_ids: ['future_entitlement'],
        }),
      ),
    ).resolves.toEqual({ accepted: true, category: 'unknown_entitlement' });
  });

  it('retains access on cancellation and revokes at expiration', async () => {
    const cancellation = {
      entitlementId: 'boo_plus',
      activeUntil: new Date('2026-10-01T00:00:00Z'),
      willRenew: true,
      latestEventTimestamp: new Date('2026-09-23T00:00:00Z'),
    } as any;
    const cancelled = harness({ entitlement: cancellation });
    await expect(
      cancelled.service.processWebhook(
        authToken,
        payload({ type: 'CANCELLATION' }),
      ),
    ).resolves.toEqual({ accepted: true, category: 'applied' });
    expect(cancellation.activeUntil).toEqual(new Date('2026-10-01T00:00:00Z'));
    expect(cancellation.willRenew).toBe(false);

    const expiration = harness({ entitlement: cancellation });
    await expect(
      expiration.service.processWebhook(
        authToken,
        payload({
          type: 'EXPIRATION',
          event_timestamp_ms: Date.parse('2026-09-24T11:00:00Z'),
        }),
      ),
    ).resolves.toEqual({ accepted: true, category: 'applied' });
    expect(cancellation.activeUntil).toEqual(new Date('2026-09-24T11:00:00Z'));
  });

  it('does not overwrite a newer entitlement event', async () => {
    const newer = {
      entitlementId: 'boo_plus',
      latestEventTimestamp: new Date('2026-09-25T00:00:00Z'),
    } as any;
    const h = harness({ entitlement: newer });
    await expect(
      h.service.processWebhook(authToken, payload()),
    ).resolves.toEqual({
      accepted: true,
      category: 'stale',
    });
  });
});
