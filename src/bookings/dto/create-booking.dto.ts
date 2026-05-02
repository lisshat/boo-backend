export class CreateBookingDto {
  providerId!: string;
  serviceId!: string;
  petId?: string;
  bookingDatetime!: string; // ISO 8601 datetime string
  notes?: string;
}
