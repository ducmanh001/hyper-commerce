import { IsEmail, IsString, MinLength, MaxLength, Matches } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-z0-9][a-z0-9_-]{1,48}[a-z0-9]$/, {
    message: 'Username must be 3-50 chars, lowercase alphanumeric, hyphen or underscore',
  })
  username!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  passwordHash!: string; // plain password; service will hash it

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName!: string;
}
