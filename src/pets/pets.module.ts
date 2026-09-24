import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pet } from './pet.entity';
import { PetsService } from './pets.service';
import { PetsController } from './pets.controller';
import { User } from '../users/user.entity';
import { UserEntitlement } from '../revenuecat/user-entitlement.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Pet, User, UserEntitlement])],
  controllers: [PetsController],
  providers: [PetsService],
  exports: [PetsService],
})
export class PetsModule {}
