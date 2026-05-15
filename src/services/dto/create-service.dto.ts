import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateServiceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  serviceName!: string;

  @IsIn(['veterinary', 'grooming', 'training', 'boarding', 'sitting', 'other'])
  @IsNotEmpty()
  category!: string;

  @Min(0)
  @IsNumber()
  price!: number;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @Min(1)
  @IsInt()
  durationMinutes!: number;

  @IsIn(['per_hour', 'per_night', 'per_day', 'per_session'])
  @IsOptional()
  pricingUnit?: string;
}