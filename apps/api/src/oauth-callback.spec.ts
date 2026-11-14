import { describe, expect, it } from 'vitest';
import { AppService } from './app.service.js';

function callbackUrl(values: Record<string, string | undefined>, provider = 'canva') {
  const service = Object.assign(Object.create(AppService.prototype), {
    config: { get: (key: string) => values[key] },
  }) as AppService;
  return (service as any).oauthCallbackUrl(provider);
}

describe('OAuth callback URL', () => {
  it('uses the public API path when production has no explicit callback base', () => {
    expect(callbackUrl({ NODE_ENV: 'production', WEB_ORIGIN: 'https://websphere.fun' })).toBe('https://websphere.fun/api/integrations/canva/callback');
  });

  it('uses an explicit callback base for deployments with a separate API origin', () => {
    expect(callbackUrl({ NODE_ENV: 'production', WEB_ORIGIN: 'https://websphere.fun', OAUTH_CALLBACK_BASE_URL: 'https://api.websphere.fun' }, 'trello')).toBe('https://api.websphere.fun/integrations/trello/callback');
  });

  it('uses the new canonical origin during the domain overlap', () => {
    expect(callbackUrl({ NODE_ENV: 'production', WEB_ORIGIN: 'https://websphere.cloud,https://websphere.fun' })).toBe('https://websphere.cloud/api/integrations/canva/callback');
  });

  it('can retain the registered legacy callback while the website moves', () => {
    expect(callbackUrl({ NODE_ENV: 'production', WEB_ORIGIN: 'https://websphere.cloud,https://websphere.fun', OAUTH_CALLBACK_BASE_URL: 'https://websphere.fun/api' }, 'google')).toBe('https://websphere.fun/api/integrations/google/callback');
  });
});
