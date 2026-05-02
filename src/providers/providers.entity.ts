import {
  Entity,
  Column,
  OneToMany,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ServiceOffering } from './service-offering.entity';

export enum VerificationStatus {
  UNSUBMITTED = 'unsubmitted',
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('provider_profiles')
export class Provider {
  @PrimaryGeneratedColumn('uuid', { name: 'profile_id' })
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'business_name', type: 'varchar' })
  businessName!: string;

  @Column({ type: 'text', nullable: true })
  bio!: string | null;

  @Column({ name: 'location', type: 'varchar', nullable: true })
  location!: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
  latitude!: number | null;

  @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true })
  longitude!: number | null;

  @Column({ name: 'profile_photo_url', type: 'text', nullable: true })
  profilePhotoUrl!: string | null;

  @Column({ name: 'is_verified', type: 'boolean', default: false })
  isVerified!: boolean;

  @Column({ name: 'verification_status', type: 'varchar', default: VerificationStatus.UNSUBMITTED })
  verificationStatus!: VerificationStatus;

  @Column({ name: 'average_rating', type: 'decimal', precision: 3, scale: 2, default: 0 })
  averageRating!: number;

  @Column({ name: 'total_reviews', type: 'int', default: 0 })
  totalReviews!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => ServiceOffering, (s) => s.provider, { eager: true })
  services!: ServiceOffering[];
}
