import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Provider } from '../providers/providers.entity';
import { ServiceOffering } from '../providers/service-offering.entity';
import { User } from '../users/user.entity';

export enum BookingStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
  RESCHEDULED = 'rescheduled',
}

export enum PaymentStatus {
  NOT_RECORDED = 'not_recorded',
  PROVIDER_RECORDED_RECEIVED = 'provider_recorded_received',
}

export enum PaymentMethod {
  CASH = 'cash',
  MPESA = 'mpesa',
  BANK_TRANSFER = 'bank_transfer',
  OTHER = 'other',
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

  @Column({ name: 'decline_reason', type: 'text', nullable: true })
  declineReason!: string | null;

  @Column({ name: 'rescheduled_from', type: 'uuid', nullable: true })
  rescheduledFrom!: string | null;

  @Column({
    name: 'agreed_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  agreedAmount!: number | null;

  @Column({ type: 'varchar', length: 3, default: 'KES' })
  currency!: string;

  @Column({
    name: 'pricing_unit_snapshot',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  pricingUnitSnapshot!: string | null;

  @Column({ name: 'duration_minutes_snapshot', type: 'int', nullable: true })
  durationMinutesSnapshot!: number | null;

  @Column({
    name: 'snapshot_source',
    type: 'varchar',
    length: 30,
    default: 'booking_time',
  })
  snapshotSource!: string;

  @Column({
    name: 'payment_status',
    type: 'varchar',
    length: 40,
    default: PaymentStatus.NOT_RECORDED,
  })
  paymentStatus!: PaymentStatus;

  @Column({
    name: 'payment_method',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  paymentMethod!: PaymentMethod | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  @Column({ name: 'provider_recorded_at', type: 'timestamptz', nullable: true })
  providerRecordedAt!: Date | null;

  @Column({
    name: 'payment_record_reversed_at',
    type: 'timestamptz',
    nullable: true,
  })
  paymentRecordReversedAt!: Date | null;

  @ManyToOne(() => Provider)
  @JoinColumn({ name: 'provider_id' })
  provider!: Provider;

  @ManyToOne(() => ServiceOffering)
  @JoinColumn({ name: 'service_id' })
  service!: ServiceOffering;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'owner_id' })
  owner!: User;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
