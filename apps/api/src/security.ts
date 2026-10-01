import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ConfigService } from './config.service.js';
// validatePassword lives in @websphere/shared now, so the web client's registration form can
// render the exact same rule-by-rule checklist the server enforces, instead of duplicating it.
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = Buffer.from(config.get('CRYPTO_KEY_BASE64'), 'base64');
  }
  encrypt(value: string) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv); const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return { ciphertext: encrypted.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') }; }
  decrypt(value: { ciphertext: string; iv: string; authTag: string }) { const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(value.iv, 'base64')); decipher.setAuthTag(Buffer.from(value.authTag, 'base64')); return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8'); }
}
