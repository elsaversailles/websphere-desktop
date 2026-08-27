import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { z } from 'zod';

const requestBodySchema = z.record(z.unknown());

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    // Field-level and DTO-specific schemas are applied in controllers. This global
    // guard ensures unscoped JSON bodies have the expected object shape.
    if (metadata.type !== 'body' || metadata.data || value === undefined) return value;
    const result = requestBodySchema.safeParse(value);
    if (result.success) return result.data;
    throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Request body must be a JSON object' });
  }
}
