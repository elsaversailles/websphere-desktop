import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { ConfigService } from './config.service.js';

@Injectable()
export class EmailService {
  constructor(private readonly config: ConfigService) {}

  configured() {
    return Boolean(this.config.get('SES_HOST') && this.config.get('SES_USER') && this.config.get('SES_PASSWORD'));
  }

  private transport() {
    const host = this.config.get('SES_HOST');
    const user = this.config.get('SES_USER');
    const pass = this.config.get('SES_PASSWORD');
    if (!host || !user || !pass) {
      throw new ServiceUnavailableException({ code: 'EMAIL_UNAVAILABLE', message: 'Email is temporarily unavailable. Check the mail configuration and try again.' });
    }
    return nodemailer.createTransport({
      host,
      port: this.config.get('SES_PORT'),
      secure: this.config.get('SES_PORT') === 465,
      auth: { user, pass },
    });
  }

  private async send(message: Parameters<ReturnType<typeof nodemailer.createTransport>['sendMail']>[0], unavailableMessage: string) {
    try {
      await this.transport().sendMail(message);
    } catch {
      throw new ServiceUnavailableException({ code: 'EMAIL_DELIVERY_FAILED', message: unavailableMessage });
    }
  }

  async sendPasswordReset(email: string, token: string) {
    const resetUrl = new URL(this.config.get('WEB_ORIGIN').split(',')[0]);
    resetUrl.searchParams.set('resetToken', token);
    await this.send({
      from: this.config.get('SES_FROM'),
      to: email,
      subject: 'Reset your WebSphere password',
      text: `Use this link to reset your password: ${resetUrl.toString()}\n\nThis link expires soon and can only be used once.`,
      html: `<p>Use the link below to reset your WebSphere password.</p><p><a href="${resetUrl.toString()}">Reset password</a></p><p>This link expires soon and can only be used once.</p>`,
    }, 'Password-reset email could not be delivered. Verify the SES sender and sandbox recipient, then try again.');
    return true;
  }

  async sendRegistrationVerification(email: string, code: string) {
    await this.send({
      from: this.config.get('SES_FROM'),
      to: email,
      subject: 'Your WebSphere verification code',
      text: `Your WebSphere verification code is ${code}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`,
      html: `<p>Your WebSphere verification code is:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>It expires in 10 minutes. If you did not request this code, you can ignore this email.</p>`,
    }, 'Verification email could not be delivered. Verify the SES sender and sandbox recipient, then try again.');
    return true;
  }
}
