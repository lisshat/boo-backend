import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Pet } from './pet.entity';
import { CreatePetDto } from './dto/create-pet.dto';
import { UpdatePetDto } from './dto/update-pet.dto';

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

  async update(petId: string, ownerId: string, dto: UpdatePetDto): Promise<Pet> {
    const pet = await this.petRepo.findOne({ where: { petId, ownerId } });
    if (!pet) throw new NotFoundException('Pet not found');
    Object.assign(pet, dto);
    return this.petRepo.save(pet);
  }
}
