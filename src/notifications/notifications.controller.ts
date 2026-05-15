import { Controller, Delete, Get, Patch, Param, Req, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  getAll(@Req() req: any) {
    return this.service.getAll(req.user.id);
  }

  @Get('unread-count')
  getUnreadCount(@Req() req: any) {
    return this.service.getUnreadCount(req.user.id);
  }

  @Patch('read-all')
  markAllAsRead(@Req() req: any) {
    return this.service.markAllAsRead(req.user.id);
  }

  @Patch(':id/read')
  markRead(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.markRead(id, req.user.id);
  }

  @Delete(':id')
  delete(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.deleteNotification(id, req.user.id);
  }
}
