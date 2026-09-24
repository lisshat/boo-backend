import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class PaymentRecordDto {
  @IsBoolean()
  received!: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['cash', 'mpesa', 'bank_transfer', 'other'])
  paymentMethod?: string;
}
