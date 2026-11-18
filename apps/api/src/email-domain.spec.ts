import { describe, expect, it, vi } from 'vitest';
import { EmailService } from './email.service.js';

function emailService(values: Record<string, string>) {
  const send = vi.fn().mockResolvedValue(undefined);
  const service = Object.assign(Object.create(EmailService.prototype), {
    config: { get: (key: string) => values[key] },
    send,
  }) as EmailService;
  return { service, send };
}

describe('email domain migration', () => {
  const settings = { NODE_ENV: 'production', WEB_ORIGIN: 'https://websphere.cloud,https://websphere.fun', SES_FROM: 'hello@websphere.fun' };

  it('creates password reset links on the new canonical origin', async () => {
    const { service, send } = emailService(settings);
    await service.sendPasswordReset('member@example.com', 'test-token');
    expect(send.mock.calls[0][0].text).toContain('https://websphere.cloud/?resetToken=test-token');
  });

  it('preserves the explicit confirmation callback during provider overlap', async () => {
    const { service, send } = emailService({ ...settings, OAUTH_CALLBACK_BASE_URL: 'https://websphere.fun/api' });
    await service.sendEmailChangeConfirmation('member@example.com', 'test-token');
    expect(send.mock.calls[0][0].text).toContain('https://websphere.fun/api/auth/email-change/confirm?token=test-token');
  });

  it('routes support mail to the configured recipient', async () => {
    const { service, send } = emailService({ ...settings, SUPPORT_EMAIL: 'support@websphere.cloud' });
    await service.sendDeactivationRequest('member@example.com', 'Close account');
    expect(send.mock.calls[0][0]).toMatchObject({ to: 'support@websphere.cloud', replyTo: 'member@example.com' });
  });
});


describe('transactional email branding', () => {
  it('keeps the configured sender address and reset link with the app display name and logo', async () => {
    const sendMail = vi.fn().mockResolvedValue({});
    const values = { WEB_ORIGIN: 'https://websphere.cloud,https://websphere.fun', SES_FROM: 'hello@websphere.cloud' };
    const service = Object.assign(Object.create(EmailService.prototype), {
      config: { get: (key: string) => values[key] }, transport: () => ({ sendMail }),
    }) as EmailService;
    await service.sendPasswordReset('recipient@example.test', 'test-token');
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: 'WebSphere', address: 'hello@websphere.cloud' },
      to: 'recipient@example.test', text: expect.stringContaining('https://websphere.cloud/?resetToken=test-token'),
      html: expect.stringContaining('https://websphere.cloud/email-logo.png'),
    }));
  });
});
