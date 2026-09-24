import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { Notification, NotificationType } from './notification.entity';
import { OneSignalPushService } from './onesignal-push.service';

export interface NotificationCreationResult {
  notification: Notification | null;
  created: boolean;
  persisted: boolean;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
    private readonly pushService: OneSignalPushService,
  ) {}

  async createNotification(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    relatedId?: string,
  ): Promise<Notification | null> {
    const result = await this.createNotificationResult(
      userId,
      type,
      title,
      message,
      relatedId,
    );
    return result.notification;
  }

  async createNotificationResult(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    relatedId?: string,
  ): Promise<NotificationCreationResult> {
    const eventKey = `${userId}:${type}:${relatedId ?? 'none'}`;
    const notificationId = this.idForEvent(eventKey);
    const n = this.repo.create({
      notificationId,
      userId,
      type,
      title,
      message: message ?? null,
      relatedId: relatedId ?? null,
    });
    try {
      const existing = await this.repo.findOne({ where: { notificationId } });
      if (existing) {
        return { notification: existing, created: false, persisted: true };
      }
      const saved = await this.repo.save(n);
      // Push is an external, best-effort side effect. The notification row
      // is already authoritative before delivery is attempted.
      try {
        await this.pushService.deliver(saved);
      } catch (error) {
        this.logger.warn(`push_delivery_failed type=${type}`);
      }
      return { notification: saved, created: true, persisted: true };
    } catch (error: any) {
      if (error?.code === '23505') {
        try {
          const existing = await this.repo.findOne({
            where: { notificationId },
          });
          if (existing) {
            return { notification: existing, created: false, persisted: true };
          }
        } catch (_) {
          // Fall through to the safe non-fatal failure path below.
        }
      }
      this.logger.error(
        `Notification persistence failed type=${type} relatedId=${relatedId ?? 'none'}`,
      );
      return { notification: null, created: false, persisted: false };
    }
  }

  private idForEvent(eventKey: string): string {
    const hex = createHash('sha256')
      .update(eventKey)
      .digest('hex')
      .slice(0, 32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  getAll(userId: string): Promise<Notification[]> {
    return this.repo.find({
      where: { userId },
      order: { isRead: 'ASC', createdAt: 'DESC' },
    });
  }

  async getUnreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.repo.count({ where: { userId, isRead: false } });
    return { count };
  }

  async markRead(notificationId: string, userId: string): Promise<void> {
    const notification = await this.repo.findOne({
      where: { notificationId, userId },
    });
    if (!notification) throw new NotFoundException('Notification not found');
    notification.isRead = true;
    await this.repo.save(notification);
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.repo.update({ userId, isRead: false }, { isRead: true });
  }

  async deleteNotification(
    notificationId: string,
    userId: string,
  ): Promise<void> {
    const notification = await this.repo.findOne({
      where: { notificationId, userId },
    });
    if (!notification) throw new NotFoundException('Notification not found');
    await this.repo.remove(notification);
  }
}
