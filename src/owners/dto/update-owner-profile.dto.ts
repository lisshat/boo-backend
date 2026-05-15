import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpdateOwnerProfileDto {
  @IsOptional()
  @IsUrl()
  profilePhotoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  locationName?: string;
}
