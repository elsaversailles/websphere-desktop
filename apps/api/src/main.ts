import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';
import { ConfigService } from './config.service.js';
import { AuditLogService } from './audit-log.service.js';
async function bootstrap() { const app = await NestFactory.create(AppModule); const settings = app.get(ConfigService); app.enableCors({ origin: settings.get('WEB_ORIGIN').split(','), credentials: true }); app.useGlobalPipes(new ZodValidationPipe()); app.useGlobalFilters(new ApiExceptionFilter(app.get(AuditLogService))); const config = new DocumentBuilder().setTitle('WebSphere API').setDescription('Academic project management API').setVersion('0.1.0').addBearerAuth().build(); SwaggerModule.setup('openapi', app, SwaggerModule.createDocument(app, config)); await app.listen(settings.get('PORT')); }
bootstrap();
