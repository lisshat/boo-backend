import { IsNotEmpty, IsString, IsUrl } from 'class-validator';

export class UploadVerificationDto {
  @IsString()
  @IsNotEmpty()
  documentType: string;

  @IsUrl()
  @IsNotEmpty()
  fileUrl: string;
}
