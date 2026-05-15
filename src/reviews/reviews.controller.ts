import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guards';
import { Roles } from '../auth/decorators/roles.decorator';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReplyReviewDto } from './dto/reply-review.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Roles('owner')
  @Post()
  create(@Req() req: any, @Body() dto: CreateReviewDto) {
    return this.reviewsService.createReview(req.user.id as string, dto);
  }

  // Owner: reviews I've written (used to track which bookings are already reviewed)
  @Roles('owner')
  @Get('me')
  getMyOwnerReviews(@Req() req: any) {
    return this.reviewsService.getMyOwnerReviews(req.user.id as string);
  }

  // Provider: my reviews (must be before :id route)
  @Roles('provider')
  @Get('provider/me')
  getMyProviderReviews(@Req() req: any) {
    return this.reviewsService.getMyProviderReviews(req.user.id as string);
  }

  // Public: reviews for a specific provider profile
  @Get('provider/:id')
  getProviderReviews(@Param('id', ParseUUIDPipe) id: string) {
    return this.reviewsService.getProviderReviews(id);
  }

  @Roles('provider')
  @Patch(':id/reply')
  reply(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplyReviewDto,
  ) {
    return this.reviewsService.replyToReview(id, req.user.id as string, dto);
  }
}
