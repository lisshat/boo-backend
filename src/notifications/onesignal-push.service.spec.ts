import { NotificationType } from './notification.entity';
import {
  OneSignalHttpTransport,
  OneSignalPushService,
} from './onesignal-push.service';

describe('OneSignalPushService', () => {
  const notification = (overrides: Record<string, unknown> = {}) =>
    ({
      notificationId: '00000000-0000-4000-8000-000000000001',
      userId: '00000000-0000-4000-8000-000000000002',
      type: NotificationType.BOOKING_COMPLETED,
      title: 'private title',
      message: 'private message',
      relatedId: '00000000-0000-4000-8000-000000000003',
      ...overrides,
    }) as any;

  afterEach(() => {
    delete process.env.ONESIGNAL_APP_ID;
    delete process.env.ONESIGNAL_REST_API_KEY;
  });

  it('targets the Boo user UUID and emits only safe review intent data', async () => {
    let captured: Record<string, unknown> | undefined;
    const transport = {
      send: jest.fn(
        async (
          _app: string,
          _key: string,
          payload: Record<string, unknown>,
        ) => {
          captured = payload;
          return { status: 202 };
        },
      ),
    } as unknown as OneSignalHttpTransport;
    process.env.ONESIGNAL_APP_ID = 'app';
    process.env.ONESIGNAL_REST_API_KEY = 'secret';

    const result = await new OneSignalPushService(transport).deliver(
      notification(),
    );

    expect(result.category).toBe('sent');
    expect(captured).toMatchObject({
      include_aliases: {
        external_id: ['00000000-0000-4000-8000-000000000002'],
      },
      target_channel: 'push',
      data: {
        type: 'review_booking',
        bookingId: '00000000-0000-4000-8000-000000000003',
      },
    });
    expect(captured).not.toHaveProperty('message', 'private message');
  });

  it('disables safely without configuration', async () => {
    const transport = { send: jest.fn() } as unknown as OneSignalHttpTransport;
    const result = await new OneSignalPushService(transport).deliver(
      notification(),
    );
    expect(result.category).toBe('disabled');
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('rejects email and provider/profile identifiers as recipients', async () => {
    const transport = { send: jest.fn() } as unknown as OneSignalHttpTransport;
    process.env.ONESIGNAL_APP_ID = 'app';
    process.env.ONESIGNAL_REST_API_KEY = 'secret';

    const result = await new OneSignalPushService(transport).deliver(
      notification({ userId: 'owner@example.com' }),
    );

    expect(result.category).toBe('invalid_recipient');
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('classifies transport timeout/network failures without throwing', async () => {
    const transport = {
      send: jest.fn().mockRejectedValue(new Error('network failure')),
    } as unknown as OneSignalHttpTransport;
    process.env.ONESIGNAL_APP_ID = 'app';
    process.env.ONESIGNAL_REST_API_KEY = 'secret';

    const result = await new OneSignalPushService(transport).deliver(
      notification(),
    );
    expect(result.category).toBe('network_error');
  });
});
