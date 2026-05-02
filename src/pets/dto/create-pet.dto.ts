import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';

export class CreatePetDto {
  @IsString()
  name!: string;

  @IsString()
  species!: string;

  @IsOptional()
  @IsString()
  breed?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  age?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
