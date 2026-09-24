import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Pet } from './pet.entity';
import { CreatePetDto } from './dto/create-pet.dto';
import { UpdatePetDto } from './dto/update-pet.dto';
import { User } from '../users/user.entity';
import { UserEntitlement } from '../revenuecat/user-entitlement.entity';

@Injectable()
export class PetsService {
  constructor(
    @InjectRepository(Pet)
    private readonly petRepo: Repository<Pet>,
    private readonly dataSource: DataSource,
  ) {}

  create(ownerId: string, dto: CreatePetDto): Promise<Pet> {
    return this.dataSource.transaction(async (manager) => {
      const user = await manager
        .getRepository(User)
        .createQueryBuilder('user')
        .where('user.id = :ownerId', { ownerId })
        .setLock('pessimistic_write')
        .getOne();
      if (!user || user.role !== 'owner') {
        throw new ForbiddenException('Only owners can create pet profiles.');
      }

      const count = await manager.getRepository(Pet).count({
        where: { ownerId },
      });
      if (count > 0) {
        const entitlement = await manager
          .getRepository(UserEntitlement)
          .createQueryBuilder('entitlement')
          .where('entitlement.user_id = :ownerId', { ownerId })
          .andWhere('entitlement.entitlement_id = :entitlementId', {
            entitlementId: 'boo_plus',
          })
          .andWhere('entitlement.active_until IS NOT NULL')
          .andWhere('entitlement.active_until > CURRENT_TIMESTAMP')
          .setLock('pessimistic_write')
          .getOne();
        if (!entitlement) {
          throw new ForbiddenException(
            'Boo Plus is required to add another pet.',
          );
        }
      }

      const pet = manager.getRepository(Pet).create({ ownerId, ...dto });
      return manager.getRepository(Pet).save(pet);
    });
  }

  findByOwnerId(ownerId: string): Promise<Pet[]> {
    return this.petRepo.find({
      where: { ownerId },
      order: { createdAt: 'ASC' },
    });
  }

  async update(
    petId: string,
    ownerId: string,
    dto: UpdatePetDto,
  ): Promise<Pet> {
    const pet = await this.petRepo.findOne({ where: { petId, ownerId } });
    if (!pet) throw new NotFoundException('Pet not found');
    Object.assign(pet, dto);
    return this.petRepo.save(pet);
  }
}
