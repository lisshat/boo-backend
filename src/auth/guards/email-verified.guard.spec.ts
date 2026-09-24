import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { EmailVerifiedGuard } from './email-verified.guard';

describe('EmailVerifiedGuard', () => {
  function context(userId = 'user-1') {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user: { id: userId } }) }),
    } as unknown as ExecutionContext;
  }

  it('reloads the current user and permits a confirmed account', async () => {
    const usersRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'user-1',
        emailVerifiedAt: new Date(),
      }),
    };
    const guard = new EmailVerifiedGuard(usersRepo as any);

    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(usersRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'user-1' },
    });
  });

  it('rejects based on the current database state even when the JWT request exists', async () => {
    const usersRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'user-1',
        emailVerifiedAt: null,
      }),
    };
    const guard = new EmailVerifiedGuard(usersRepo as any);

    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(guard.canActivate(context())).rejects.toMatchObject({
      response: {
        code: 'EMAIL_VERIFICATION_REQUIRED',
      },
    });
  });
});
