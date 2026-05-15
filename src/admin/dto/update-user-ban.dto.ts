import { IsBoolean } from 'class-validator';

export class UpdateUserBanDto {
  @IsBoolean()
  isBanned: boolean;
}
