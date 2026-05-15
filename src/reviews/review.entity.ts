import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Booking } from '../bookings/bookings.entity';
import { User } from '../users/user.entity';
import { Provider } from '../providers/providers.entity';

@Entity('reviews')
export class Review {
  @PrimaryGeneratedColumn('uuid', { name: 'review_id' })
  reviewId!: string;

  @Column({ name: 'booking_id', type: 'uuid', unique: true })
  bookingId!: string;

  @ManyToOne(() => Booking, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booking_id' })
  booking!: Booking;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'owner_id' })
  owner!: User;

  @Column({ name: 'provider_id', type: 'uuid' })
  providerId!: string;

  @ManyToOne(() => Provider)
  @JoinColumn({ name: 'provider_id' })
  provider!: Provider;

  @Column({ type: 'int' })
  rating!: number;

  @Column({ type: 'text', nullable: true })
  text!: string | null;

  @Column({ name: 'provider_reply', type: 'text', nullable: true })
  providerReply!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
