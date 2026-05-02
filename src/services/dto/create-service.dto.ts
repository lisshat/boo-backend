import { IsString, IsNotEmpty, IsIn, IsNumber, IsBoolean, IsOptional, Min } from 'class-validator';

export class CreateServiceDto{  
    @IsString()
    @IsNotEmpty()
    serviceName : string;

    @IsIn(['veterinary','grooming','training','boarding','sitting','other'])
    @IsNotEmpty()
    category: string;

    @Min(0)
    @IsNotEmpty()
    @IsNumber()
    price: number;

    @IsString()
    @IsOptional()
    description: string;

    @IsBoolean()
    @IsOptional()
    isActive: boolean;

    @Min(1)
    @IsNotEmpty()
    @IsNumber()
    durationMinutes: number;
}