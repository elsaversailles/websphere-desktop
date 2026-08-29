import { describe, expect, it } from 'vitest';
import { passwordChangeSchema, passwordForgotSchema, passwordResetSchema, profileUpdateSchema } from './index.js';

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
