import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Provider } from './providers.entity';

export type ServiceCategory =
  | 'veterinary'
  | 'grooming'
  | 'training'
  | 'boarding'
  | 'sitting'
  | 'other';

@Entity('services')
export class ServiceOffering {
  @PrimaryGeneratedColumn('uuid', { name: 'service_id' })
  serviceId!: string;

  @ManyToOne(() => Provider, (p) => p.services, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profile_id' })
  provider!: Provider;

  @Column({ name: 'service_name', type: 'varchar' })
  serviceName!: string;

  @Column({ name: 'category', type: 'varchar' })
  category!: ServiceCategory;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'duration_minutes', type: 'int' })
  durationMinutes!: number;

  @Column({ name: 'price', type: 'decimal', precision: 10, scale: 2 })
  price!: number;

  @Column({ name: 'pricing_unit', type: 'varchar', default: 'per_session' })
  pricingUnit!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
