import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ConfigService } from './config.service.js';
export function validatePassword(password: string) {
  if (password.length < 8) return { ok: false, reason: 'length' as const };
  if (!/[^A-Za-z0-9\s]/.test(password)) return { ok: false, reason: 'missing_symbol' as const };
  if (!/\d/.test(password)) return { ok: false, reason: 'missing_number' as const };
  const lower = password.toLowerCase();
  for (let i = 0; i < lower.length - 3; i++) { const chars = lower.slice(i, i + 4); const deltas = [...chars].slice(1).map((c, n) => c.charCodeAt(0) - chars.charCodeAt(n)); if (deltas.every((d) => d === 1) || deltas.every((d) => d === -1)) return { ok: false, reason: 'sequence' as const }; }
  return { ok: true as const };
}
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = Buffer.from(config.get('CRYPTO_KEY_BASE64'), 'base64');
  }
  encrypt(value: string) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv); const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return { ciphertext: encrypted.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') }; }
  decrypt(value: { ciphertext: string; iv: string; authTag: string }) { const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(value.iv, 'base64')); decipher.setAuthTag(Buffer.from(value.authTag, 'base64')); return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8'); }
}
