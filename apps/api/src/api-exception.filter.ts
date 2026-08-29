import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ZodError } from 'zod';

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    const isZodError = exception instanceof ZodError;
    const status = isZodError ? HttpStatus.BAD_REQUEST : exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = isZodError
      ? { code: 'VALIDATION_FAILED', message: 'One or more fields are invalid', fields: Object.fromEntries(exception.issues.map((issue) => [String(issue.path[0] ?? 'body'), issue.message])) }
      : exception instanceof HttpException ? exception.getResponse() : { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' };
    if (!isZodError && !(exception instanceof HttpException)) {
      this.logger.error('Unhandled API exception', exception instanceof Error ? exception.stack : String(exception));
    }
    response.status(status).json(typeof body === 'string' ? { code: 'HTTP_ERROR', message: body } : body);
  }
}
