import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ReportReason, ReportStatus } from '../report.entity';

const numberValue = ({ value }: { value: unknown }) => Number(value);

export class ListReportsDto {
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @IsOptional()
  @IsEnum(ReportReason)
  reason?: ReportReason;

  @IsOptional()
  @Transform(numberValue)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(numberValue)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}
