import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('user_entitlements')
@Unique('uq_user_entitlements_user_entitlement', ['userId', 'entitlementId'])
export class UserEntitlement {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'entitlement_id', type: 'varchar', length: 80 })
  entitlementId!: string;

  @Column({ name: 'product_id', type: 'varchar', length: 160, nullable: true })
  productId!: string | null;

  @Column({ type: 'varchar', length: 32 })
  environment!: string;

  @Column({ name: 'active_until', type: 'timestamptz', nullable: true })
  activeUntil!: Date | null;

  @Column({ name: 'will_renew', type: 'boolean', nullable: true })
  willRenew!: boolean | null;

  @Column({ name: 'latest_event_timestamp', type: 'timestamptz' })
  latestEventTimestamp!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
