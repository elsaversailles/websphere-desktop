import { beforeEach, describe, expect, it, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { deliverNotificationEmail } from './notification-email.js';

vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn() } }));

const env = { SES_HOST: 'email.example.test', SES_PORT: '587', SES_USER: 'user', SES_PASSWORD: 'password', SES_FROM: 'sender@example.test' };

function fixture(emailEnabled = true, status = 'active') {
  const findUnique = vi.fn().mockResolvedValue({
    message: 'Task <review> assigned',
    user: { email: 'recipient@example.test', status, preference: { emailEnabled } },
  });
  return { notification: { findUnique } } as any;
}

describe('notification email delivery', () => {
  const sendMail = vi.fn().mockResolvedValue(undefined);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail } as any);
  });

  it('sends the notification through the configured SMTP transport', async () => {
    await deliverNotificationEmail(fixture(), 'notification-1', env);
    expect(nodemailer.createTransport).toHaveBeenCalledWith({ host: env.SES_HOST, port: 587, secure: false, auth: { user: env.SES_USER, pass: env.SES_PASSWORD } });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'recipient@example.test', from: env.SES_FROM, text: expect.stringContaining('Task <review> assigned'), html: expect.stringContaining('Task &lt;review&gt; assigned') }));
  });

  it('respects the email opt-out and inactive account status', async () => {
    await deliverNotificationEmail(fixture(false), 'notification-1', env);
    await deliverNotificationEmail(fixture(true, 'archived'), 'notification-2', env);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('emails the due-today task reminder to the responsible user’s registered address', async () => {
    const prisma = fixture();
    prisma.notification.findUnique.mockResolvedValueOnce({
      type: 'deadline_reminder', relatedType: 'task', message: 'Task “Report” is due today.',
      user: { email: 'responsible@example.test', status: 'active', preference: { emailEnabled: true } },
    });
    await deliverNotificationEmail(prisma, 'due-today-1', env);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'responsible@example.test', subject: 'WebSphere task deadline reminder', text: expect.stringContaining('is due today.') }));
  });

  it('throws on SMTP failure so BullMQ can retry', async () => {
    sendMail.mockRejectedValueOnce(new Error('SMTP unavailable'));
    await expect(deliverNotificationEmail(fixture(), 'notification-1', env)).rejects.toThrow('SMTP unavailable');
  });
});
