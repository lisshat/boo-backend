import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Provider } from './providers.entity';

@Entity('provider_availability')
export class ProviderAvailability {
  @PrimaryGeneratedColumn('uuid', { name: 'availability_id' })
  id!: string;

  @Column({ name: 'profile_id', type: 'uuid' })
  profileId!: string;

  @ManyToOne(() => Provider, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profile_id' })
  provider!: Provider;

  @Column({ name: 'day_of_week', type: 'int' })
  dayOfWeek!: number;

  // Stored as "HH:MM:SS" string by Postgres TIME type
  @Column({ name: 'start_time', type: 'time' })
  startTime!: string;

  @Column({ name: 'end_time', type: 'time' })
  endTime!: string;

  @Column({ name: 'is_available', type: 'boolean', default: true })
  isAvailable!: boolean;
}
