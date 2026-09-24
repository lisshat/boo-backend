import { BadRequestException } from '@nestjs/common';
import { ServiceOffering } from '../providers/service-offering.entity';

export interface BookingInterval {
  start: Date;
  end: Date;
}

export function bookingInterval(
  start: Date,
  service: ServiceOffering,
): BookingInterval {
  const minutes = Number(service.durationMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new BadRequestException(
      'Service duration must be a positive number of minutes',
    );
  }
  return { start, end: new Date(start.getTime() + minutes * 60_000) };
}

export function intervalsOverlap(
  a: BookingInterval,
  b: BookingInterval,
): boolean {
  return a.start < b.end && a.end > b.start;
}
