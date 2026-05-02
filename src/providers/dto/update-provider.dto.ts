// src/providers/dto/update-provider.dto.ts
import { IsString, IsOptional } from 'class-validator';

export class UpdateProviderDto {
  @IsOptional()
  @IsString()
  businessName?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsString()
  location?: string;
}
