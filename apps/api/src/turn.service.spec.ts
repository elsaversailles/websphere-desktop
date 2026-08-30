import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TurnService } from './turn.service.js';

const values = {
  NODE_ENV: 'production', TURN_HOST: 'turn.websphere.test', TURN_SHARED_SECRET: 'a-very-long-turn-shared-secret-for-tests', TURN_REALM: 'websphere', TURN_CREDENTIAL_TTL_SECONDS: 3600, TURN_STUN_URL: undefined,
};
const config = { get: (key: keyof typeof values) => values[key] };

describe('TurnService', () => {
  it('issues a time-bound coturn REST credential without returning the shared secret', () => {
    const servers = new TurnService(config as any).iceServers('user-1', 1_000_000);
    const username = '4600:user-1';

    expect(servers).toEqual([
      { urls: 'stun:turn.websphere.test:3478' },
      { urls: ['turn:turn.websphere.test:3478?transport=udp', 'turn:turn.websphere.test:3478?transport=tcp', 'turns:turn.websphere.test:5349?transport=tcp'], username, credential: createHmac('sha1', values.TURN_SHARED_SECRET).update(username).digest('base64') },
    ]);
    expect(JSON.stringify(servers)).not.toContain(values.TURN_SHARED_SECRET);
  });

  it('uses STUN-only local development configuration when no TURN relay is configured', () => {
    const local = new TurnService({ get: (key: string) => ({ NODE_ENV: 'development', TURN_HOST: undefined, TURN_SHARED_SECRET: undefined, TURN_STUN_URL: undefined } as Record<string, unknown>)[key] } as any);
    expect(local.iceServers('user-1')).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
  });
});
