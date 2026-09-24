import { ForbiddenException } from '@nestjs/common';
import { PetsService } from './pets.service';
import { Pet } from './pet.entity';
import { User } from '../users/user.entity';
import { UserEntitlement } from '../revenuecat/user-entitlement.entity';

const ownerId = '00000000-0000-4000-8000-000000000001';
const petDto = { name: 'Milo', species: 'dog' };

function harness(count: number, hasPlus: boolean, role = 'owner') {
  const userQuery = {
    where: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue({ id: ownerId, role }),
  };
  const entitlementQuery = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    getOne: jest
      .fn()
      .mockResolvedValue(hasPlus ? { entitlementId: 'boo_plus' } : null),
  };
  const petRepo = {
    count: jest.fn().mockResolvedValue(count),
    create: jest.fn((value: unknown) => value),
    save: jest.fn(async (value: unknown) => value),
  };
  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === User) return { createQueryBuilder: () => userQuery };
      if (entity === UserEntitlement)
        return { createQueryBuilder: () => entitlementQuery };
      return petRepo;
    }),
  };
  const dataSource = {
    transaction: jest.fn(async (callback: (value: typeof manager) => unknown) =>
      callback(manager),
    ),
  };
  const service = new PetsService({} as any, dataSource as any);
  return { service, userQuery, petRepo };
}

describe('PetsService additional-pet boundary', () => {
  it('allows the first pet without an entitlement', async () => {
    const { service } = harness(0, false);
    await expect(service.create(ownerId, petDto as any)).resolves.toEqual({
      ownerId,
      ...petDto,
    });
  });

  it('rejects a second pet for a free owner', async () => {
    const { service } = harness(1, false);
    await expect(service.create(ownerId, petDto as any)).rejects.toThrow(
      'Boo Plus is required to add another pet.',
    );
  });

  it('allows additional pets for an active Boo Plus owner', async () => {
    const { service } = harness(2, true);
    await expect(service.create(ownerId, petDto as any)).resolves.toBeDefined();
  });

  it('rejects provider use of owner pet creation and locks the user first', async () => {
    const { service, userQuery } = harness(0, false, 'provider');
    await expect(service.create(ownerId, petDto as any)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(userQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
  });
});
