import {
  IsString,
  IsOptional,
  IsNumber,
  IsIn,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class ServiceDto {
  @IsString()
  @IsIn(['veterinary', 'grooming', 'training', 'boarding', 'sitting', 'other'])
  category!: string;

  @IsString()
  serviceName!: string;

  @IsNumber()
  durationMinutes!: number;

  @IsNumber()
  price!: number;

  @IsOptional()
  @IsString()
  description?: string;
}

export class OnboardProviderDto {
  @IsString()
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
