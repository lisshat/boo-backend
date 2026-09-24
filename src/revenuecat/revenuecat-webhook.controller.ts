import { Controller, Headers, HttpCode, Post, Body } from '@nestjs/common';
import { RevenueCatEntitlementsService } from './revenuecat-entitlements.service';

@Controller('webhooks/revenuecat')
export class RevenueCatWebhookController {
  constructor(private readonly service: RevenueCatEntitlementsService) {}

  @Post()
  @HttpCode(200)
  receive(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    return this.service.processWebhook(authorization, body);
  }
}
