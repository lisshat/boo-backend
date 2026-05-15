import { IsString, IsOptional, IsNumber, IsUrl, Min, Max, MinLength, MaxLength } from 'class-validator';

export class UpdateProviderDto {
  @IsOptional() @IsString() businessName?: string;
  @IsOptional() @IsString() @MinLength(200) @MaxLength(500) bio?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsUrl() profilePhotoUrl?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number;
}
