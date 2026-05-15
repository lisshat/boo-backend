import { IsOptional, IsString } from 'class-validator';

export class DeclineBookingDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
