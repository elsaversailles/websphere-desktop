import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  WEB_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  LOGIN_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  SES_HOST: z.string().optional(),
  SES_PORT: z.coerce.number().int().positive().default(587),
  SES_USER: z.string().optional(),
  SES_PASSWORD: z.string().optional(),
  SES_FROM: z.string().email().default('noreply@example.edu'),
  CRYPTO_KEY_BASE64: z.string().refine((value) => Buffer.from(value, 'base64').length === 32, 'must decode to exactly 32 bytes'),
  UPLOAD_DIR: z.string().min(1).default('/var/lib/websphere/uploads'),
  UPLOAD_PUBLIC_PATH: z.string().startsWith('/').default('/uploads'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  TURN_HOST: z.string().min(1).optional(),
  TURN_REALM: z.string().min(1).default('websphere'),
  TURN_SHARED_SECRET: z.string().min(32).optional(),
  TURN_CREDENTIAL_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3600),
  TURN_STUN_URL: z.string().min(1).optional(),
  TURN_EXTERNAL_IP: z.string().min(1).optional(),
  TURN_CERT_DIR: z.string().min(1).optional(),
  TURN_CERT_NAME: z.string().min(1).optional(),
  TURN_RELAY_MIN_PORT: z.coerce.number().int().min(1024).max(65_535).default(49160),
  TURN_RELAY_MAX_PORT: z.coerce.number().int().min(1024).max(65_535).default(49200),
}).superRefine((value, context) => {
  if (value.TURN_RELAY_MIN_PORT > value.TURN_RELAY_MAX_PORT) context.addIssue({ code: z.ZodIssueCode.custom, path: ['TURN_RELAY_MAX_PORT'], message: 'must be greater than or equal to TURN_RELAY_MIN_PORT' });
  if (value.NODE_ENV === 'production') {
    for (const key of ['TURN_HOST', 'TURN_SHARED_SECRET', 'TURN_EXTERNAL_IP', 'TURN_CERT_DIR', 'TURN_CERT_NAME'] as const) if (!value[key]) context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'is required in production for CGNAT-safe calls' });
  }
});

export type AppConfig = z.infer<typeof environmentSchema>;

@Injectable()
export class ConfigService {
  private readonly values = environmentSchema.parse(process.env);

  get<Key extends keyof AppConfig>(key: Key): AppConfig[Key] {
    return this.values[key];
  }
}
