import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ReportReason {
  HARASSMENT = 'harassment',
  THREATS = 'threats',
  SCAM = 'scam',
  SPAM = 'spam',
  INAPPROPRIATE_CONTENT = 'inappropriate_content',
  UNSAFE_CONDUCT = 'unsafe_conduct',
  DISCRIMINATION = 'discrimination',
  OTHER = 'other',
}

export enum ReportStatus {
  SUBMITTED = 'submitted',
  REVIEWING = 'reviewing',
  RESOLVED = 'resolved',
  DISMISSED = 'dismissed',
}

@Entity('reports')
@Index(['status', 'createdAt'])
@Index(['reportedUserId', 'status'])
@Index(['reporterUserId', 'createdAt'])
@Index(['bookingId'])
@Index(['streamChannelId'])
export class Report {
  @PrimaryGeneratedColumn('uuid', { name: 'report_id' })
  reportId!: string;

  @Column({ name: 'reporter_user_id', type: 'uuid' })
  reporterUserId!: string;

  @Column({ name: 'reported_user_id', type: 'uuid' })
  reportedUserId!: string;

  @Column({ name: 'provider_profile_id', type: 'uuid', nullable: true })
  providerProfileId!: string | null;

  @Column({ name: 'booking_id', type: 'uuid', nullable: true })
  bookingId!: string | null;

  @Column({
    name: 'stream_channel_type',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  streamChannelType!: string | null;

  @Column({
    name: 'stream_channel_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  streamChannelId!: string | null;

  @Column({ type: 'varchar', length: 40 })
  reason!: ReportReason;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 20, default: ReportStatus.SUBMITTED })
  status!: ReportStatus;

  @Column({ name: 'assigned_admin_id', type: 'uuid', nullable: true })
  assignedAdminId!: string | null;

  @Column({ name: 'resolution_notes', type: 'text', nullable: true })
  resolutionNotes!: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
