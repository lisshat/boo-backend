import { Injectable, Logger } from '@nestjs/common';
import { Notification, NotificationType } from './notification.entity';

export interface OneSignalTransportResponse {
  status: number;
}

export interface OneSignalTransport {
  send(
    appId: string,
    apiKey: string,
    payload: Record<string, unknown>,
  ): Promise<OneSignalTransportResponse>;
}

@Injectable()
export class OneSignalHttpTransport implements OneSignalTransport {
  async send(
    appId: string,
    apiKey: string,
    payload: Record<string, unknown>,
  ): Promise<OneSignalTransportResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch('https://api.onesignal.com/notifications', {
        method: 'POST',
        headers: {
          Authorization: `Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ app_id: appId, ...payload }),
        signal: controller.signal,
      });
      return { status: response.status };
    } finally {
      clearTimeout(timer);
    }
  }
}

export type PushDeliveryCategory =
  | 'sent'
  | 'disabled'
  | 'invalid_recipient'
  | 'timeout'
  | 'network_error'
  | 'unauthorized'
  | 'rate_limited'
  | 'rejected';

export interface PushDeliveryResult {
  category: PushDeliveryCategory;
}

@Injectable()
export class OneSignalPushService {
  private readonly logger = new Logger(OneSignalPushService.name);

  constructor(private readonly transport: OneSignalHttpTransport) {}

  async deliver(notification: Notification): Promise<PushDeliveryResult> {
    const appId = process.env.ONESIGNAL_APP_ID?.trim();
    const apiKey = process.env.ONESIGNAL_REST_API_KEY?.trim();
    if (!appId || !apiKey) {
      this.logger[appId || apiKey ? 'warn' : 'debug'](
        appId || apiKey
          ? 'push_disabled_invalid_configuration'
          : 'push_disabled_missing_configuration',
      );
      return { category: 'disabled' };
    }
    if (!this.isUuid(notification.userId)) {
      this.logger.warn('push_rejected_invalid_recipient');
      return { category: 'invalid_recipient' };
    }

    const payload: Record<string, unknown> = {
      include_aliases: { external_id: [notification.userId] },
      target_channel: 'push',
      headings: { en: this.safeTitle(notification.type) },
      contents: { en: this.safeBody(notification.type) },
    };
    const data = this.navigationData(notification);
    if (data) payload.data = data;

    try {
      const response = await this.transport.send(appId, apiKey, payload);
      const category = this.categoryForStatus(response.status);
      if (category !== 'sent') {
        this.logger.warn(`push_delivery_${category} type=${notification.type}`);
      }
      return { category };
    } catch (error) {
      const category = this.isAbort(error) ? 'timeout' : 'network_error';
      this.logger.warn(`push_delivery_${category} type=${notification.type}`);
      return { category };
    }
  }

  private safeTitle(type: string): string {
    switch (type) {
      case NotificationType.BOOKING_REQUEST:
        return 'New booking request';
      case NotificationType.BOOKING_ACCEPTED:
        return 'Your booking was accepted';
      case NotificationType.BOOKING_DECLINED:
      case NotificationType.BOOKING_CANCELLED:
      case NotificationType.BOOKING_RESCHEDULED:
        return 'Booking updated';
      case NotificationType.BOOKING_COMPLETED:
        return 'Service completed';
      case NotificationType.REVIEW_SUBMITTED:
      case NotificationType.REVIEW_REPLIED:
        return 'You received a review update';
      case NotificationType.VERIFICATION_SUBMITTED:
      case NotificationType.VERIFICATION_APPROVED:
      case NotificationType.VERIFICATION_REJECTED:
        return 'Verification update';
      default:
        return 'Important account update';
    }
  }

  private safeBody(type: string): string {
    switch (type) {
      case NotificationType.BOOKING_REQUEST:
        return 'You have a new booking request.';
      case NotificationType.BOOKING_ACCEPTED:
        return 'Your booking has been accepted.';
      case NotificationType.BOOKING_COMPLETED:
        return 'Your service is complete.';
      case NotificationType.REVIEW_SUBMITTED:
      case NotificationType.REVIEW_REPLIED:
        return 'There is an update to a review.';
      case NotificationType.VERIFICATION_SUBMITTED:
      case NotificationType.VERIFICATION_APPROVED:
      case NotificationType.VERIFICATION_REJECTED:
        return 'There is an update to verification.';
      default:
        return 'There is an update in your Boo account.';
    }
  }

  private navigationData(
    notification: Notification,
  ): Record<string, string> | null {
    if (
      notification.type === NotificationType.BOOKING_COMPLETED &&
      notification.relatedId &&
      this.isUuid(notification.relatedId)
    ) {
      return { type: 'review_booking', bookingId: notification.relatedId };
    }
    return null;
  }

  private categoryForStatus(status: number): PushDeliveryCategory {
    if (status >= 200 && status < 300) return 'sent';
    if (status === 401 || status === 403) return 'unauthorized';
    if (status === 429) return 'rate_limited';
    return 'rejected';
  }

  private isAbort(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }
}
