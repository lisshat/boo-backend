import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Provider, VerificationStatus } from './providers.entity';
import { ServiceOffering } from './service-offering.entity';
import { UpdateProviderDto } from './dto/update-provider.dto';
import { OnboardProviderDto } from './dto/onboard-provider.dto';

@Injectable()
export class ProvidersService {
  constructor(
    @InjectRepository(Provider)
    private readonly providerRepo: Repository<Provider>,
    @InjectRepository(ServiceOffering)
    private readonly serviceRepo: Repository<ServiceOffering>,
  ) {}

  findAll(): Promise<Provider[]> {
    return this.providerRepo.find({
      order: { averageRating: 'DESC' },
    });
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

  async updateByUserId(userId: string, dto: UpdateProviderDto): Promise<Provider> {
    const provider = await this.findByUserId(userId);
    Object.assign(provider, dto);
    return this.providerRepo.save(provider);
  }

  async onboard(userId: string, dto: OnboardProviderDto): Promise<Provider> {
    const existing = await this.providerRepo.findOne({ where: { userId } });
    if (existing) throw new ConflictException('Provider profile already exists');

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
      category: dto.service.category as any,
      durationMinutes: dto.service.durationMinutes,
      price: dto.service.price,
      description: dto.service.description ?? null,
    });
    await this.serviceRepo.save(service);

    return saved;
  }
}
