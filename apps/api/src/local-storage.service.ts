import { BadRequestException, Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConfigService } from './config.service.js';

@Injectable()
export class LocalStorageService {
  private readonly uploadDir: string;
  private readonly publicPath: string;

  constructor(config: ConfigService) {
    this.uploadDir = resolve(config.get('UPLOAD_DIR'));
    this.publicPath = config.get('UPLOAD_PUBLIC_PATH').replace(/\/$/, '');
  }

  async saveAvatar(file: { originalname: string; mimetype: string; buffer: Buffer }) {
    const extension = this.detectImageExtension(file.buffer);
    const declaredExtension = extname(basename(file.originalname)).toLowerCase();
    const allowedMime = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype.toLowerCase());
    if (!extension || !allowedMime || !['.jpg', '.jpeg', '.png', '.webp'].includes(declaredExtension)) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Avatar must be a valid JPG, PNG, or WebP image', fields: { file: 'unsupported image format' } });
    if (!file.buffer.length || file.buffer.length > 5 * 1024 * 1024) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Avatar must be between 1 byte and 5 MB', fields: { file: 'invalid image size' } });
    await mkdir(this.uploadDir, { recursive: true });
    const storedName = `${randomUUID()}${extension}`;
    await writeFile(join(this.uploadDir, storedName), file.buffer, { flag: 'wx', mode: 0o640 });
    return `${this.publicPath}/${storedName}`;
  }

  private detectImageExtension(content: Buffer) {
    if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return '.jpg';
    if (content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
    if (content.length >= 12 && content.subarray(0, 4).toString('ascii') === 'RIFF' && content.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
    return null;
  }
  readPublicFile(fileName: string) {
    if (basename(fileName) !== fileName || !/^[a-f0-9-]+\.(jpg|jpeg|png|webp)$/i.test(fileName)) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid upload path' });
    return readFile(join(this.uploadDir, fileName));
  }
}
