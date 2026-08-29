import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { ConfigService } from './config.service.js';

@Injectable()
export class EmailService {
  constructor(private readonly config: ConfigService) {}

  configured() {
    return Boolean(this.config.get('SES_HOST') && this.config.get('SES_USER') && this.config.get('SES_PASSWORD'));
  }

  async sendPasswordReset(email: string, token: string) {
    const host = this.config.get('SES_HOST');
    const user = this.config.get('SES_USER');
    const pass = this.config.get('SES_PASSWORD');
    if (!host || !user || !pass) {
      if (this.config.get('NODE_ENV') === 'production') {
        throw new ServiceUnavailableException({ code: 'EMAIL_UNAVAILABLE', message: 'Password-reset email is temporarily unavailable' });
      }
      return false;
    }
    const resetUrl = new URL(this.config.get('WEB_ORIGIN').split(',')[0]);
    resetUrl.searchParams.set('resetToken', token);
    const transport = nodemailer.createTransport({
      host,
      port: this.config.get('SES_PORT'),
      secure: this.config.get('SES_PORT') === 465,
      auth: { user, pass },
    });
    await transport.sendMail({
      from: this.config.get('SES_FROM'),
      to: email,
      subject: 'Reset your WebSphere password',
      text: `Use this link to reset your password: ${resetUrl.toString()}\n\nThis link expires soon and can only be used once.`,
      html: `<p>Use the link below to reset your WebSphere password.</p><p><a href="${resetUrl.toString()}">Reset password</a></p><p>This link expires soon and can only be used once.</p>`,
    });
    return true;
  }
}
