import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OwnerProfile } from './owner-profile.entity';
import { UpdateOwnerProfileDto } from './dto/update-owner-profile.dto';

@Injectable()
export class OwnersService {
  constructor(
    @InjectRepository(OwnerProfile)
    private readonly ownerProfilesRepo: Repository<OwnerProfile>,
  ) {}

  async getMe(userId: string): Promise<OwnerProfile> {
    let profile = await this.ownerProfilesRepo.findOne({ where: { userId } });
    if (!profile) {
      profile = this.ownerProfilesRepo.create({ userId });
      profile = await this.ownerProfilesRepo.save(profile);
    }
    return profile;
  }

  async updateMe(
    userId: string,
    dto: UpdateOwnerProfileDto,
  ): Promise<OwnerProfile> {
    const profile = await this.getMe(userId);
    if (dto.profilePhotoUrl !== undefined) {
      profile.profilePhotoUrl = dto.profilePhotoUrl;
    }
    if (dto.locationName !== undefined) {
      profile.locationName = dto.locationName;
    }
    return this.ownerProfilesRepo.save(profile);
  }
}
