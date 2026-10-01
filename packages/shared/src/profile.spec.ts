import { describe, expect, it } from 'vitest';
import { loginSchema, passwordChangeSchema, passwordForgotSchema, passwordRequirements, passwordResetSchema, profileUpdateSchema, registerSchema, registrationOtpRequestSchema, validatePassword } from './index.js';

describe('profile and password contracts', () => {
  it('accepts a complete valid profile update and trims values', () => {
    expect(profileUpdateSchema.parse({ fullName: '  Ada Lovelace  ', email: 'ada@example.edu', institution: 'University', course: 'Computing' })).toEqual({
      fullName: 'Ada Lovelace', email: 'ada@example.edu', institution: 'University', course: 'Computing',
    });
  });

  it.each([
    [{ fullName: '' }, 'fullName'],
    [{ email: 'not-an-email' }, 'email'],
    [{ institution: ' ' }, 'institution'],
    [{ course: 'x' }, 'course'],
  ])('rejects invalid profile field %s', (input, field) => {
    const result = profileUpdateSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toContain(field);
  });

  it('validates all password lifecycle request shapes', () => {
    expect(passwordForgotSchema.safeParse({ email: 'member@example.edu' }).success).toBe(true);
    expect(passwordChangeSchema.safeParse({ oldPassword: 'old-password', password: 'New!Pass9', confirm: 'New!Pass9' }).success).toBe(true);
    expect(passwordResetSchema.safeParse({ token: 'a'.repeat(64), password: 'New!Pass9', confirm: 'New!Pass9' }).success).toBe(true);
  });
});

describe('blank-email guardrail', () => {
  it.each([
    ['login', loginSchema, { email: '', password: 'whatever' }],
    ['login (whitespace only)', loginSchema, { email: '   ', password: 'whatever' }],
    ['admin login uses the same schema', loginSchema, { email: '', password: 'whatever' }],
    ['password reset request', passwordForgotSchema, { email: '' }],
    ['registration', registerSchema, { fullName: 'Ada Lovelace', email: '', password: 'Valid!Pass9', institution: 'University', course: 'Computing' }],
    ['registration OTP request', registrationOtpRequestSchema, { email: '' }],
  ])('rejects a blank email on %s with a clear "required" message, not a generic one', (_label, schema, input) => {
    const result = (schema as { safeParse: (value: unknown) => { success: boolean; error?: { issues: Array<{ message: string; path: unknown[] }> } } }).safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const emailIssue = result.error!.issues.find((issue) => issue.path.includes('email'));
      expect(emailIssue?.message).toBe('Email is required');
    }
  });

  it('still rejects a missing password at login distinctly from a missing email', () => {
    const result = loginSchema.safeParse({ email: 'member@example.edu', password: '' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe('Password is required');
  });
});

describe('disposable email guardrail', () => {
  it.each([
    'student@mailinator.com', 'student@10minutemail.com', 'student@yopmail.com', 'student@guerrillamail.com',
  ])('refuses %s on registration', (email) => {
    const result = registerSchema.safeParse({ fullName: 'Ada Lovelace', email, password: 'Valid!Pass9', institution: 'University', course: 'Computing' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toContain('Disposable or temporary email');
  });

  it('refuses a disposable domain regardless of case', () => {
    expect(registerSchema.safeParse({ fullName: 'Ada Lovelace', email: 'student@MAILINATOR.COM', password: 'Valid!Pass9', institution: 'University', course: 'Computing' }).success).toBe(false);
  });

  it('still accepts an ordinary email on registration', () => {
    expect(registerSchema.safeParse({ fullName: 'Ada Lovelace', email: 'ada@example.edu', password: 'Valid!Pass9', institution: 'University', course: 'Computing' }).success).toBe(true);
  });

  it('does NOT block disposable domains at login or password reset — only at account/email creation', () => {
    // An account could already exist under one of these domains from before this guardrail
    // existed; blocking it here would lock a real person out of their own account.
    expect(loginSchema.safeParse({ email: 'student@mailinator.com', password: 'whatever' }).success).toBe(true);
    expect(passwordForgotSchema.safeParse({ email: 'student@mailinator.com' }).success).toBe(true);
  });

  it('refuses a disposable domain when changing your email on your profile', () => {
    const result = profileUpdateSchema.safeParse({ email: 'student@mailinator.com' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toContain('Disposable or temporary email');
  });
});

describe('password policy', () => {
  it('accepts a password that satisfies every rule', () => {
    expect(validatePassword('Valid!Pass9')).toEqual({ ok: true });
  });

  it('reports every rule’s pass/fail state, not just the first failure', () => {
    const requirements = passwordRequirements('abcd');
    expect(requirements.find((r) => r.id === 'length')?.met).toBe(false);
    expect(requirements.find((r) => r.id === 'symbol')?.met).toBe(false);
    expect(requirements.find((r) => r.id === 'number')?.met).toBe(false);
    expect(requirements.find((r) => r.id === 'sequence')?.met).toBe(false);
  });

  it('rejects a password shorter than 8 characters', () => {
    expect(validatePassword('Ab1!')).toEqual({ ok: false, reason: 'length' });
  });

  it('rejects a password longer than 64 characters', () => {
    expect(validatePassword(`Aa1!${'a'.repeat(61)}`).ok).toBe(false);
    expect(validatePassword(`Aa1!${'a'.repeat(61)}`)).toMatchObject({ reason: 'length' });
  });

  it('accepts a password at exactly the 64-character boundary', () => {
    expect(validatePassword(`Aa1!${'a'.repeat(60)}`)).toEqual({ ok: true });
  });

  it('rejects a password with no symbol', () => {
    expect(validatePassword('Password9')).toEqual({ ok: false, reason: 'symbol' });
  });

  it('rejects a password with no number', () => {
    expect(validatePassword('Password!')).toEqual({ ok: false, reason: 'number' });
  });

  it('rejects an obvious ascending or descending sequence, even once length/symbol/number all pass', () => {
    expect(validatePassword('ab1!cdef')).toEqual({ ok: false, reason: 'sequence' }); // ...cdef ascends
    expect(validatePassword('ab1!fedc')).toEqual({ ok: false, reason: 'sequence' }); // ...fedc descends
  });
});
