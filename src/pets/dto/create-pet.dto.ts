import { IsString, IsOptional, IsInt, IsNotEmpty, MaxLength, Min, Max } from 'class-validator';

export class CreatePetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsString()
  @IsNotEmpty()
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
