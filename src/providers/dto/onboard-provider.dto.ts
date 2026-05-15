import {
  IsString,
  IsOptional,
  IsNumber,
  IsInt,
  IsIn,
  IsNotEmpty,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class ServiceDto {
  @IsString()
  @IsIn(['veterinary', 'grooming', 'training', 'boarding', 'sitting', 'other'])
  category!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  serviceName!: string;

  @IsInt()
  @Min(1)
  durationMinutes!: number;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsString()
  description?: string;
}

export class OnboardProviderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  businessName!: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @ValidateNested()
  @Type(() => ServiceDto)
  service!: ServiceDto;
}
