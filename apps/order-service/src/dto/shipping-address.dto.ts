import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  MaxLength,
  Matches,
} from 'class-validator';

/**
 * ShippingAddressDto — validated address object.
 * Used inside CreateOrderDto.
 */
export class ShippingAddressDto {
  @ApiProperty({ example: 'Nguyễn Văn A' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fullName!: string;

  @ApiProperty({ example: '0901234567' })
  @IsString()
  @Matches(/^(\+84|0)[3|5|7|8|9][0-9]{8}$/, { message: 'Invalid Vietnamese phone number' })
  phone!: string;

  @ApiProperty({ example: '123 Nguyễn Huệ, Quận 1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  addressLine1!: string;

  @ApiPropertyOptional({ example: 'Tầng 5' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  addressLine2?: string;

  @ApiProperty({ example: 'Hồ Chí Minh' })
  @IsString()
  @IsNotEmpty()
  city!: string;

  @ApiPropertyOptional({ example: 'Quận 1' })
  @IsOptional()
  @IsString()
  district?: string;

  @ApiPropertyOptional({ example: '700000' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{5,6}$/, { message: 'Invalid postal code' })
  postalCode?: string;

  @ApiProperty({ example: 'VN' })
  @IsString()
  @MaxLength(2)
  countryCode!: string;
}
