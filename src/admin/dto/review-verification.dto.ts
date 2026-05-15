import { IsIn, IsOptional, IsString } from 'class-validator';

export class ReviewVerificationDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  adminNotes?: string;
}
