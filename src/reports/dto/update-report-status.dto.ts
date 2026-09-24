import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ReportStatus } from '../report.entity';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateReportStatusDto {
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @IsOptional()
  @IsUUID()
  assignedAdminId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  @Transform(trim)
  resolutionNotes?: string;
}
