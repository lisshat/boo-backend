import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pet_profiles')
export class Pet {
  @PrimaryGeneratedColumn('uuid', { name: 'pet_id' })
  petId!: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @Column({ name: 'name', type: 'varchar' })
  name!: string;

  @Column({ name: 'species', type: 'varchar' })
  species!: string;

  @Column({ name: 'breed', type: 'varchar', nullable: true })
  breed!: string | null;

  @Column({ name: 'age', type: 'int', nullable: true })
  age!: number | null;

  @Column({ name: 'photo_url', type: 'text', nullable: true })
  photoUrl!: string | null;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
