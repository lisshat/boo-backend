import { IsDateString, IsNotEmpty } from 'class-validator';

export class RescheduleBookingDto {
  @IsDateString()
  @IsNotEmpty()
  newDatetime!: string;
}
