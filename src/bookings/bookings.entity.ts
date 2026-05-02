import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum BookingStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
}

@Entity('bookings')
export class Booking {
  @PrimaryGeneratedColumn('uuid', { name: 'booking_id' })
  bookingId!: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @Column({ name: 'provider_id', type: 'uuid' })
  providerId!: string;

  @Column({ name: 'service_id', type: 'uuid' })
  serviceId!: string;

  @Column({ name: 'pet_id', type: 'uuid', nullable: true })
  petId!: string | null;

  @Column({ type: 'varchar', default: BookingStatus.PENDING })
  status!: BookingStatus;

  @Column({ name: 'booking_datetime', type: 'timestamptz' })
  bookingDatetime!: Date;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'cancel_reason', type: 'text', nullable: true })
  cancelReason!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
