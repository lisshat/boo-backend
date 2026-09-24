import { buildBooOtpEmail } from './transactional-email.templates';

describe('transactional OTP email templates', () => {
  it('keeps confirmation and password reset wording distinct', () => {
    const confirmation = buildBooOtpEmail({
      kind: 'email_confirmation',
      code: '771067',
      expiresInMinutes: 10,
    });
    const reset = buildBooOtpEmail({
      kind: 'password_reset',
      code: '528194',
      expiresInMinutes: 10,
    });

    expect(confirmation.subject).toBe('Confirm your Boo email');
    expect(reset.subject).toBe('Reset your Boo password');
    expect(confirmation.html).toContain('Confirm your email');
    expect(reset.html).toContain('Reset your password');
    expect(confirmation.text).toContain('771067');
    expect(reset.text).toContain('528194');
    expect(confirmation.html).toContain('771');
    expect(confirmation.html).toContain('067');
    expect(reset.html).toContain('528');
    expect(reset.html).toContain('194');
  });

  it('escapes dynamic code values and never places codes in URLs', () => {
    const message = buildBooOtpEmail({
      kind: 'password_reset',
      code: '<123456',
      expiresInMinutes: 10,
      supportEmail: 'support@example.com',
    });

    expect(message.html).toContain('&lt;123');
    expect(message.html).not.toContain('123456</a>');
    expect(message.html).not.toMatch(/https?:[^" ]*(123456|%3C)/i);
    expect(message.html).toContain('mailto:support@example.com');
  });

  it('has complete text and artwork-independent security copy', () => {
    const message = buildBooOtpEmail({
      kind: 'email_confirmation',
      code: '123456',
      expiresInMinutes: 10,
    });

    expect(message.html).toContain('This code expires in 10 minutes.');
    expect(message.html).toContain(
      'Boo staff will never ask you for this code.',
    );
    expect(message.html).toContain(
      'This is an automated security email from Boo Pet Care.',
    );
    expect(message.text).toContain('Contact Boo support if you need help.');
    expect(message.html).not.toContain('528 194');
    expect(message.html).not.toContain('771 067');
  });
});
