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
  CRYPTO_KEY_BASE64: z.string().refine((value) => Buffer.from(value, 'base64').length === 32, 'must decode to exactly 32 bytes'),
  UPLOAD_DIR: z.string().min(1).default('/var/lib/websphere/uploads'),
  UPLOAD_PUBLIC_PATH: z.string().startsWith('/').default('/uploads'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
});

export type AppConfig = z.infer<typeof environmentSchema>;

@Injectable()
export class ConfigService {
  private readonly values = environmentSchema.parse(process.env);

  get<Key extends keyof AppConfig>(key: Key): AppConfig[Key] {
    return this.values[key];
  }
}
