import {
  ConflictException,
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
    private readonly streamService: StreamService,
  ) {}

  findAll(): Promise<Provider[]> {
    return this.providerRepo.find({
      relations: ['services'],
      order: { averageRating: 'DESC' },
    });
  }

  async findNearby(lat: number, lng: number, radiusKm: number): Promise<Provider[]> {
    const qb = this.providerRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.services', 'services');

    if (radiusKm > 0) {
      qb.where(
        `(p.latitude IS NULL OR (
          6371.0 * acos(LEAST(1.0,
            cos(radians(:lat)) * cos(radians(p.latitude::double precision))
            * cos(radians(p.longitude::double precision) - radians(:lng))
            + sin(radians(:lat)) * sin(radians(p.latitude::double precision))
          ))
        ) <= :radius)`,
        { lat, lng, radius: radiusKm },
      );
    }

    return qb.orderBy('p.averageRating', 'DESC').getMany();
  }

  async findOne(id: string): Promise<Provider> {
    const provider = await this.providerRepo.findOne({ where: { id } });
    if (!provider) throw new NotFoundException('Provider not found');
    return provider;
  }

  async findVerified(): Promise<Provider[]> {
    return this.providerRepo.find({
      where: { isVerified: true },
      order: { averageRating: 'DESC' },
    });
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
      verificationStatus: VerificationStatus.PENDING,
    });
    const saved = await this.providerRepo.save(profile);

    const service = this.serviceRepo.create({
      provider: saved,
      serviceName: dto.service.serviceName,
      category: dto.service.category as ServiceCategory,
      durationMinutes: dto.service.durationMinutes,
      price: dto.service.price,
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

  async getProviderAvailability(profileId: string): Promise<ProviderAvailability[]> {
    return this.availabilityRepo.find({
      where: { profileId },
      order: { dayOfWeek: 'ASC' },
    });
  }

  async initChatForProvider(profileId: string): Promise<{ userId: string }> {
    const provider = await this.findOne(profileId);
    const user = await this.userRepo.findOne({ where: { id: provider.userId } });
    if (user) {
      await this.streamService.upsertStreamUser(user.id, user.fullName, user.role);
    }
    return { userId: provider.userId };
  }
}
