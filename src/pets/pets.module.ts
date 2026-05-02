import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pet } from './pet.entity';
import { PetsService } from './pets.service';
import { PetsController } from './pets.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Pet])],
  controllers: [PetsController],
  providers: [PetsService],
  exports: [PetsService],
})
export class PetsModule {}
