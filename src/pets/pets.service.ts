import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Pet } from './pet.entity';
import { CreatePetDto } from './dto/create-pet.dto';

@Injectable()
export class PetsService {
  constructor(
    @InjectRepository(Pet)
    private readonly petRepo: Repository<Pet>,
  ) {}

  create(ownerId: string, dto: CreatePetDto): Promise<Pet> {
    const pet = this.petRepo.create({ ownerId, ...dto });
    return this.petRepo.save(pet);
  }

  findByOwnerId(ownerId: string): Promise<Pet[]> {
    return this.petRepo.find({
      where: { ownerId },
      order: { createdAt: 'ASC' },
    });
  }
}
