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

  async saveAvatar(fileName: string, contentBase64: string) {
    const extension = extname(basename(fileName)).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Avatar must be a JPG, PNG, or WebP image' });
    const content = Buffer.from(contentBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!content.length || content.length > 5 * 1024 * 1024) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Avatar must be between 1 byte and 5 MB' });
    await mkdir(this.uploadDir, { recursive: true });
    const storedName = `${randomUUID()}${extension}`;
    await writeFile(join(this.uploadDir, storedName), content, { flag: 'wx', mode: 0o640 });
    return `${this.publicPath}/${storedName}`;
  }
  readPublicFile(fileName: string) {
    if (basename(fileName) !== fileName || !/^[a-f0-9-]+\.(jpg|jpeg|png|webp)$/i.test(fileName)) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid upload path' });
    return readFile(join(this.uploadDir, fileName));
  }
}
