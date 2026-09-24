import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Provider, VerificationStatus } from './providers.entity';
import { ServiceOffering, ServiceCategory } from './service-offering.entity';
import { ProviderAvailability } from './provider-availability.entity';
import { UpdateProviderDto } from './dto/update-provider.dto';
import { OnboardProviderDto } from './dto/onboard-provider.dto';
import { UpsertAvailabilityDto } from './dto/upsert-availability.dto';
import { UpdateServiceDto } from '../services/dto/update-service.dto';
import { CreateServiceDto } from '../services/dto/create-service.dto';
import { User } from '../users/user.entity';
import { StreamService } from '../stream/stream.service';
import { Booking } from '../bookings/bookings.entity';

@Injectable()
export class ProvidersService {
  constructor(
    @InjectRepository(Provider)
    private readonly providerRepo: Repository<Provider>,
    @InjectRepository(ServiceOffering)
    private readonly serviceRepo: Repository<ServiceOffering>,
    @InjectRepository(ProviderAvailability)
    private readonly availabilityRepo: Repository<ProviderAvailability>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    private readonly streamService: StreamService,
  ) {}

  // ── Ranking helpers ─────────────────────────────────────────────────────────

  private getVerificationBoost(
    verificationStatus: string,
    isVerified: boolean,
  ): number {
    if (
      isVerified === true ||
      verificationStatus === VerificationStatus.APPROVED
    ) {
      return 1.0;
    }
    if (verificationStatus === VerificationStatus.PENDING) {
      return 0.3;
    }
    return 0.0; // unsubmitted or anything else
    // Future: IDENTITY_VERIFIED (+0.7) when that tier is added
  }

  private calculateRecommendedScore(
    averageRating: number | null,
    verificationStatus: string,
    isVerified: boolean,
  ): number {
    const rating = averageRating != null ? Number(averageRating) : 0;
    return rating + this.getVerificationBoost(verificationStatus, isVerified);
  }

  private haversineKm(
    lat1: number,
    lng1: number,
    lat2: number | null,
    lng2: number | null,
  ): number {
    if (
      lat2 == null ||
      lng2 == null ||
      !Number.isFinite(lat2) ||
      !Number.isFinite(lng2) ||
      Math.abs(lat2) > 90 ||
      Math.abs(lng2) > 180
    )
      return Infinity;
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    const clamped = Math.max(0, Math.min(1, a));
    return R * 2 * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
  }

  private sortByRecommended(
    providers: Provider[],
    lat?: number,
    lng?: number,
  ): (Provider & { recommendedScore: number })[] {
    const withScore = providers.map((p) => ({
      ...p,
      recommendedScore: this.calculateRecommendedScore(
        p.averageRating,
        p.verificationStatus,
        p.isVerified,
      ),
    }));

    return withScore.sort((a, b) => {
      // 1. recommendedScore DESC
      if (b.recommendedScore !== a.recommendedScore) {
        return b.recommendedScore - a.recommendedScore;
      }
      // 2. rating DESC
      const rA = Number(a.averageRating ?? 0);
      const rB = Number(b.averageRating ?? 0);
      if (rB !== rA) return rB - rA;
      // 3. totalReviews DESC
      if (b.totalReviews !== a.totalReviews) {
        return b.totalReviews - a.totalReviews;
      }
      // 4. distance ASC (only when caller has a position)
      if (lat != null && lng != null) {
        const dA = this.haversineKm(
          lat,
          lng,
          a.latitude == null ? null : Number(a.latitude),
          a.longitude == null ? null : Number(a.longitude),
        );
        const dB = this.haversineKm(
          lat,
          lng,
          b.latitude == null ? null : Number(b.latitude),
          b.longitude == null ? null : Number(b.longitude),
        );
        if (dA !== dB) return dA - dB;
      }
      return 0;
    });
  }

  private discoveryShape(
    provider: Provider & { recommendedScore?: number },
    lat?: number,
    lng?: number,
  ) {
    const { latitude, longitude, userId, ...safe } = provider;
    const distanceKm =
      lat != null && lng != null
        ? this.haversineKm(
            lat,
            lng,
            latitude == null ? null : Number(latitude),
            longitude == null ? null : Number(longitude),
          )
        : undefined;
    return {
      ...safe,
      ...(distanceKm != null && Number.isFinite(distanceKm)
        ? { distanceKm: Number(distanceKm.toFixed(2)) }
        : {}),
    };
  }

  // ── Listing queries ──────────────────────────────────────────────────────────

  async findAll(): Promise<any[]> {
    const providers = await this.providerRepo
      .createQueryBuilder('provider')
      .innerJoin(
        User,
        'user',
        'user.id = provider.user_id AND user.email_verified_at IS NOT NULL',
      )
      .leftJoinAndSelect('provider.services', 'services')
      .where('provider.verification_status != :rejected', {
        rejected: VerificationStatus.REJECTED,
      })
      .getMany();
    return this.sortByRecommended(providers).map((provider) =>
      this.discoveryShape(provider),
    );
  }

  async findNearby(lat: number, lng: number, radiusKm: number): Promise<any[]> {
    const qb = this.providerRepo
      .createQueryBuilder('p')
      .innerJoin(
        User,
        'user',
        'user.id = p.user_id AND user.email_verified_at IS NOT NULL',
      )
      .leftJoinAndSelect('p.services', 'services')
      .where('p.verificationStatus != :rejected', {
        rejected: VerificationStatus.REJECTED,
      });

    if (radiusKm >= 0) {
      qb.andWhere(
        `(p.latitude IS NOT NULL AND p.longitude IS NOT NULL
          AND p.latitude BETWEEN -90 AND 90
          AND p.longitude BETWEEN -180 AND 180
          AND 6371.0 * acos(GREATEST(-1.0, LEAST(1.0,
            cos(radians(:lat)) * cos(radians(p.latitude::double precision))
            * cos(radians(p.longitude::double precision) - radians(:lng))
            + sin(radians(:lat)) * sin(radians(p.latitude::double precision))
          ))) <= :radius)`,
        { lat, lng, radius: radiusKm },
      );
    }

    const providers = await qb.getMany();
    return this.sortByRecommended(providers, lat, lng).map((provider) =>
      this.discoveryShape(provider, lat, lng),
    );
  }

  async findOne(id: string): Promise<any> {
    const provider = await this.providerRepo
      .createQueryBuilder('provider')
      .innerJoin(
        User,
        'user',
        'user.id = provider.user_id AND user.email_verified_at IS NOT NULL',
      )
      .leftJoinAndSelect('provider.services', 'services')
      .where('provider.profile_id = :id', { id })
      .getOne();
    if (!provider) throw new NotFoundException('Provider not found');
    return this.discoveryShape(provider);
  }

  async findVerified(): Promise<Provider[]> {
    return this.providerRepo
      .createQueryBuilder('provider')
      .innerJoin(
        User,
        'user',
        'user.id = provider.user_id AND user.email_verified_at IS NOT NULL',
      )
      .where('provider.is_verified = true')
      .orderBy('provider.average_rating', 'DESC')
      .getMany();
  }

  async findByUserId(userId: string): Promise<Provider> {
    const provider = await this.providerRepo.findOne({ where: { userId } });
    if (!provider) throw new NotFoundException('Provider not found');
    return provider;
  }

  async updateByUserId(
    userId: string,
    dto: UpdateProviderDto,
  ): Promise<Provider> {
    const provider = await this.findByUserId(userId);
    Object.assign(provider, dto);
    return this.providerRepo.save(provider);
  }

  async onboard(userId: string, dto: OnboardProviderDto): Promise<Provider> {
    const existing = await this.providerRepo.findOne({ where: { userId } });
    if (existing)
      throw new ConflictException('Provider profile already exists');

    const profile = this.providerRepo.create({
      userId,
      businessName: dto.businessName,
      bio: dto.bio ?? null,
      location: dto.location ?? null,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      verificationStatus: VerificationStatus.PENDING,
    });
    const saved = await this.providerRepo.save(profile);

    const service = this.serviceRepo.create({
      provider: saved,
      serviceName: dto.service.serviceName,
      category: dto.service.category as ServiceCategory,
      durationMinutes: dto.service.durationMinutes,
      price: dto.service.price,
      pricingUnit: dto.service.pricingUnit ?? 'per_session',
      description: dto.service.description ?? null,
    });
    await this.serviceRepo.save(service);

    return saved;
  }

  async addService(
    providerId: string,
    dto: CreateServiceDto,
  ): Promise<ServiceOffering> {
    const provider = await this.findByUserId(providerId);
    const service = this.serviceRepo.create({
      serviceName: dto.serviceName,
      category: dto.category as ServiceCategory,
      durationMinutes: dto.durationMinutes,
      price: dto.price,
      description: dto.description ?? null,
      provider: provider,
    });
    return await this.serviceRepo.save(service);
  }

  async updateServicebyId(
    providerId: string,
    serviceId: string,
    dto: UpdateServiceDto,
  ): Promise<ServiceOffering> {
    const provider = await this.findByUserId(providerId);
    const service = await this.serviceRepo.findOne({
      where: {
        serviceId,
        provider: { id: provider.id },
      },
    });
    if (!service) throw new NotFoundException('Service not found');

    Object.assign(service, dto);
    return this.serviceRepo.save(service);
  }

  // ── Availability ────────────────────────────────────────────────────────────

  async getMyAvailability(userId: string): Promise<ProviderAvailability[]> {
    const provider = await this.findByUserId(userId);
    return this.availabilityRepo.find({
      where: { profileId: provider.id },
      order: { dayOfWeek: 'ASC' },
    });
  }

  async upsertAvailability(
    userId: string,
    dto: UpsertAvailabilityDto,
  ): Promise<ProviderAvailability[]> {
    const provider = await this.findByUserId(userId);
    // Delete existing rows, then re-insert — simpler than ON CONFLICT upsert
    await this.availabilityRepo.delete({ profileId: provider.id });
    const entities = dto.days.map((day) =>
      this.availabilityRepo.create({
        profileId: provider.id,
        dayOfWeek: day.dayOfWeek,
        startTime: day.startTime,
        endTime: day.endTime,
        isAvailable: day.isAvailable,
      }),
    );
    await this.availabilityRepo.save(entities);
    return this.availabilityRepo.find({
      where: { profileId: provider.id },
      order: { dayOfWeek: 'ASC' },
    });
  }

  async getProviderAvailability(
    profileId: string,
  ): Promise<ProviderAvailability[]> {
    return this.availabilityRepo.find({
      where: { profileId },
      order: { dayOfWeek: 'ASC' },
    });
  }

  async initChatForProvider(
    profileId: string,
    requesterId: string,
  ): Promise<{ channelId: string; channelType: 'messaging' }> {
    const provider = await this.providerRepo.findOne({
      where: { id: profileId },
    });
    if (!provider) throw new NotFoundException('Provider not found');
    const user = await this.userRepo.findOne({
      where: { id: provider.userId },
    });
    if (!user) throw new NotFoundException('Provider user not found');
    if (user.role !== 'provider')
      throw new ForbiddenException('Target user is not a provider');
    if (
      user.isBanned ||
      !user.emailVerifiedAt ||
      provider.verificationStatus === VerificationStatus.REJECTED
    )
      throw new ForbiddenException(
        'This provider is unavailable for new chats',
      );
    const requester = await this.userRepo.findOne({
      where: { id: requesterId },
    });
    if (!requester) throw new NotFoundException('User not found');
    if (requester.role !== 'owner')
      throw new ForbiddenException('Only owners can start provider chats');
    await this.streamService.upsertStreamUser(
      requester.id,
      requester.fullName,
      requester.role,
    );
    await this.streamService.upsertStreamUser(
      user.id,
      user.fullName,
      user.role,
    );
    const memberIds = [requester.id, user.id].sort();
    const channelId = await this.streamService.resolveOwnerProviderChannel(
      requester.id,
      user.id,
    );
    const createdChannelId = await this.streamService.createDirectChannel(
      channelId,
      memberIds,
      requester.id,
      {
        providerProfileId: provider.id,
        providerVerificationStatus: provider.verificationStatus,
      },
    );
    return { channelId: createdChannelId, channelType: 'messaging' };
  }
}
