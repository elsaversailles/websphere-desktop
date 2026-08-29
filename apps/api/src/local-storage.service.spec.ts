import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalStorageService } from './local-storage.service.js';

describe('LocalStorageService avatars', () => {
  let uploadDir: string;
  let storage: LocalStorageService;

  beforeAll(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'websphere-avatar-'));
    storage = new LocalStorageService({ get: (key: string) => key === 'UPLOAD_DIR' ? uploadDir : '/uploads' } as never);
  });
  afterAll(async () => { await rm(uploadDir, { recursive: true, force: true }); });

  it('stores a verified PNG under a generated public URL', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const url = await storage.saveAvatar({ originalname: 'profile.png', mimetype: 'image/png', buffer: png });
    expect(url).toMatch(/^\/uploads\/[a-f0-9-]+\.png$/);
    await expect(readFile(join(uploadDir, url.split('/').at(-1)!))).resolves.toEqual(png);
  });

  it('rejects an extension-only image spoof', async () => {
    await expect(storage.saveAvatar({ originalname: 'profile.png', mimetype: 'image/png', buffer: Buffer.from('not an image') })).rejects.toMatchObject({ status: 400 });
  });
});
