import { ValueTransformer } from 'typeorm';

export class ColumnNumberTransformer implements ValueTransformer {
  from(value: string | null): number | null {
    return value !== null ? parseFloat(value) : null;
  }

  to(value: number | null): string | null {
    return value !== null ? value.toString() : null;
  }
}
