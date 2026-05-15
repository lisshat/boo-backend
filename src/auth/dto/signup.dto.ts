import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SignupDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(72)
  password!: string;

  @IsString()
  @IsOptional()
  fullName?: string;

  @IsIn(['owner', 'provider'])
  @IsOptional()
  role?: 'owner' | 'provider';
}
