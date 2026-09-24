import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Review } from './review.entity';
import { Booking, BookingStatus } from '../bookings/bookings.entity';
import { Provider } from '../providers/providers.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReplyReviewDto } from './dto/reply-review.dto';
import { NotificationType } from '../notifications/notification.entity';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(Provider)
    private readonly providerRepo: Repository<Provider>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createReview(ownerId: string, dto: CreateReviewDto): Promise<Review> {
    const normalizedText = dto.text?.trim();
    if (dto.text !== undefined && !normalizedText) {
      throw new BadRequestException('Review text cannot be blank');
    }
    const booking = await this.bookingRepo.findOne({
      where: { bookingId: dto.bookingId, ownerId },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== BookingStatus.COMPLETED)
      throw new BadRequestException('Can only review completed bookings');

    // One review per owner per provider — stricter than per-booking
    const existing = await this.reviewRepo.findOne({
      where: { bookingId: dto.bookingId },
    });
    if (existing)
      throw new ConflictException('You have already reviewed this booking');

    const review = this.reviewRepo.create({
      bookingId: dto.bookingId,
      ownerId,
      providerId: booking.providerId,
      rating: dto.rating,
      text: normalizedText ?? null,
    });
    await this.reviewRepo.save(review);

    await this.updateProviderRating(booking.providerId);

    const provider = await this.providerRepo.findOne({
      where: { id: booking.providerId },
    });
    if (provider) {
      await this.notificationsService.createNotification(
        provider.userId,
        NotificationType.REVIEW_SUBMITTED,
        'New Review',
        `You received a ${dto.rating}-star review!`,
        review.reviewId,
      );
    }

    return review;
  }

  async getProviderReviews(profileId: string): Promise<any[]> {
    const reviews = await this.reviewRepo.find({
      where: { providerId: profileId },
      relations: ['owner'],
      order: { createdAt: 'DESC' },
    });
    return reviews.map(({ owner, ...review }) => ({
      ...review,
      verifiedBooking: true,
      owner: owner ? { id: owner.id, fullName: owner.fullName } : null,
    }));
  }

  // Provider sees their own reviews via GET /reviews/provider/me
  async getMyProviderReviews(userId: string): Promise<any[]> {
    const provider = await this.providerRepo.findOne({ where: { userId } });
    if (!provider) throw new NotFoundException('Provider not found');
    const reviews = await this.reviewRepo.find({
      where: { providerId: provider.id },
      relations: ['owner'],
      order: { createdAt: 'DESC' },
    });
    return reviews.map(({ owner, ...review }) => ({
      ...review,
      verifiedBooking: true,
      owner: owner ? { id: owner.id, fullName: owner.fullName } : null,
    }));
  }

  // Owner sees reviews they've written — used to know which bookings are already reviewed
  async getMyOwnerReviews(ownerId: string): Promise<Review[]> {
    const reviews = await this.reviewRepo.find({
      where: { ownerId },
      order: { createdAt: 'DESC' },
    });
    return reviews.map((review) => ({
      ...review,
      verifiedBooking: true,
    })) as Review[];
  }

  async replyToReview(
    reviewId: string,
    userId: string,
    dto: ReplyReviewDto,
  ): Promise<Review> {
    const provider = await this.providerRepo.findOne({ where: { userId } });
    if (!provider) throw new NotFoundException('Provider not found');

    const review = await this.reviewRepo.findOne({
      where: { reviewId, providerId: provider.id },
      relations: ['owner'],
    });
    if (!review) throw new NotFoundException('Review not found');

    review.providerReply = dto.reply;
    const saved = await this.reviewRepo.save(review);

    // Notify the owner that the provider replied
    await this.notificationsService.createNotification(
      review.ownerId,
      NotificationType.REVIEW_REPLIED,
      'Provider replied to your review',
      `Your review received a response.`,
      reviewId,
    );

    return saved;
  }

  private async updateProviderRating(profileId: string): Promise<void> {
    const result = await this.reviewRepo
      .createQueryBuilder('r')
      .select('AVG(r.rating)', 'avg')
      .addSelect('COUNT(r.review_id)', 'cnt')
      .where('r.provider_id = :profileId', { profileId })
      .getRawOne<{ avg: string; cnt: string }>();

    await this.providerRepo.update(
      { id: profileId },
      {
        averageRating: parseFloat(result?.avg ?? '0') || 0,
        totalReviews: parseInt(result?.cnt ?? '0', 10) || 0,
      },
    );
  }
}
