import { NotificationType } from './notification.entity';
import { NotificationsService } from './notifications.service';

describe('NotificationsService push ordering', () => {
  const n = {
    notificationId: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
    type: NotificationType.BOOKING_REQUEST,
    title: 'title',
    message: 'message',
    relatedId: '00000000-0000-4000-8000-000000000003',
  } as any;

  it('pushes only after a newly persisted notification', async () => {
    const order: string[] = [];
    const repo = {
      create: jest.fn(() => n),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async () => {
        order.push('save');
        return n;
      }),
    } as any;
    const push = {
      deliver: jest.fn(async () => {
        order.push('push');
        return { category: 'sent' };
      }),
    };
    const service = new NotificationsService(repo, push as any);

    const result = await service.createNotificationResult(
      n.userId,
      NotificationType.BOOKING_REQUEST,
      n.title,
      n.message,
      n.relatedId,
    );

    expect(result).toMatchObject({ created: true, persisted: true });
    expect(order).toEqual(['save', 'push']);
    expect(push.deliver).toHaveBeenCalledWith(n);
  });

  it('does not push deterministic duplicates or persistence failures', async () => {
    const push = { deliver: jest.fn() };
    const duplicateRepo = {
      create: jest.fn(() => n),
      findOne: jest.fn().mockResolvedValue(n),
      save: jest.fn(),
    } as any;
    const duplicate = new NotificationsService(duplicateRepo, push as any);
    const duplicateResult = await duplicate.createNotificationResult(
      n.userId,
      NotificationType.BOOKING_REQUEST,
      n.title,
      n.message,
      n.relatedId,
    );
    expect(duplicateResult.created).toBe(false);

    const failedRepo = {
      create: jest.fn(() => n),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockRejectedValue(new Error('db unavailable')),
    } as any;
    const failed = new NotificationsService(failedRepo, push as any);
    const failedResult = await failed.createNotificationResult(
      n.userId,
      NotificationType.BOOKING_REQUEST,
      n.title,
      n.message,
      n.relatedId,
    );
    expect(failedResult.persisted).toBe(false);
    expect(push.deliver).not.toHaveBeenCalled();
  });
});
