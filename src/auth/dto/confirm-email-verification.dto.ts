import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class ConfirmEmailVerificationDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'Code must be exactly six digits' })
  code!: string;
}
