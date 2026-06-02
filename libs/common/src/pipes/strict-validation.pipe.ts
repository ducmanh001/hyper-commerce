import {
  PipeTransform,
  Injectable,
  ArgumentMetadata,
  BadRequestException,
} from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

/**
 * StrictValidationPipe
 *
 * - whitelist: strips unknown properties
 * - forbidNonWhitelisted: throws if unknown properties present (prevents mass-assignment)
 * - transform: auto-converts types (string "1" → number 1)
 * - skipMissingProperties: false — all required fields must be present
 *
 * Registered globally in main.ts for every service.
 */
@Injectable()
export class StrictValidationPipe implements PipeTransform<unknown> {
  async transform(value: unknown, { metatype }: ArgumentMetadata): Promise<unknown> {
    if (!metatype || !this.toValidate(metatype)) {
      return value;
    }

    const object = plainToInstance(metatype, value);
    const errors = await validate(object as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
      skipMissingProperties: false,
    });

    if (errors.length > 0) {
      const messages = errors.flatMap((err) =>
        Object.values(err.constraints ?? {}),
      );
      throw new BadRequestException({
        statusCode: 400,
        message: 'Validation failed',
        errors: messages,
      });
    }

    return object;
  }

  private toValidate(metatype: new (...args: unknown[]) => unknown): boolean {
    const primitives: Array<new (...args: unknown[]) => unknown> = [
      String, Boolean, Number, Array, Object,
    ];
    return !primitives.includes(metatype);
  }
}
