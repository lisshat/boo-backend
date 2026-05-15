import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Min } from "class-validator";

export class UpdateServiceDto {
  @Min(0)
  @IsOptional()
  @IsNumber()
  price: number;

  @IsString()
  @IsOptional()
  description: string;

  @IsBoolean()
  @IsOptional()
  isActive: boolean;

  @IsString()
  @IsOptional()
  serviceName: string;

  @Min(1)
  @IsOptional()
  @IsNumber()
  durationMinutes: number;

  @IsIn(['veterinary', 'grooming', 'training', 'boarding', 'sitting', 'other'])
  @IsOptional()
  category: string;

  @IsString()
  @IsOptional()
  pricingUnit: string;
}