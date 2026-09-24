import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class WarnUserDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  message!: string;

  @IsOptional()
  @IsUUID()
  reportId?: string;
}
