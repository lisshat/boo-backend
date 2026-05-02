import { BookingStatus } from '../bookings.entity';

export class ConfirmBookingDto {
  status!: BookingStatus.ACCEPTED | BookingStatus.DECLINED;
}
