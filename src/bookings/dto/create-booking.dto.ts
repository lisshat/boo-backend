import { IsISO8601, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateBookingDto {
  @IsUUID()
  providerId!: string;

  @IsUUID()
  serviceId!: string;

  @IsUUID()
  @IsOptional()
  petId?: string;

  @IsISO8601()
  bookingDatetime!: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
