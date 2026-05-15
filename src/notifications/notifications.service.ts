import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './notification.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
  ) {}

  createNotification(
    userId: string,
    type: string,
    title: string,
    message: string,
    relatedId?: string,
  ): Promise<Notification> {
    const n = this.repo.create({
      userId,
      type,
      title,
      message: message ?? null,
      relatedId: relatedId ?? null,
    });
    return this.repo.save(n);
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

  async deleteNotification(notificationId: string, userId: string): Promise<void> {
    const notification = await this.repo.findOne({ where: { notificationId, userId } });
    if (!notification) throw new NotFoundException('Notification not found');
    await this.repo.remove(notification);
  }
}
