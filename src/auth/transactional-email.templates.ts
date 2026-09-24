export type OtpEmailKind = 'email_confirmation' | 'password_reset';

export interface OtpEmailTemplate {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

function groupedCode(code: string): { first: string; second: string } {
  const normalized = code.trim();
  return { first: normalized.slice(0, 3), second: normalized.slice(3, 6) };
}

/**
 * Shared Boo transactional OTP email structure.
 * TODO(Boo artwork): Replace the CSS/text paw placeholder with approved hosted PNG email assets.
 */
export function buildBooOtpEmail(options: {
  kind: OtpEmailKind;
  code: string;
  expiresInMinutes: number;
  supportEmail?: string;
}): OtpEmailTemplate {
  const isReset = options.kind === 'password_reset';
  const subject = isReset
    ? 'Reset your Boo password'
    : 'Confirm your Boo email';
  const heading = isReset ? 'Reset your password' : 'Confirm your email';
  const explanation = isReset
    ? 'Use this six-digit code to create a new password for your Boo account.'
    : 'Use this six-digit code to finish confirming your Boo account.';
  const unrequested = isReset
    ? "If you didn't request a password reset, you can ignore this email. Your password will remain unchanged."
    : "If you didn't request this, you can safely ignore this email.";
  const minutes = Math.max(1, Math.ceil(options.expiresInMinutes));
  const { first, second } = groupedCode(options.code);
  const safeFirst = escapeHtml(first);
  const safeSecond = escapeHtml(second);
  const safeCode = escapeHtml(options.code.trim());
  const safeHeading = escapeHtml(heading);
  const safeExplanation = escapeHtml(explanation);
  const safeUnrequested = escapeHtml(unrequested);
  const supportEmail = options.supportEmail?.trim();
  const safeSupportEmail = supportEmail ? escapeHtml(supportEmail) : '';
  const supportHtml = supportEmail
    ? `<a href="mailto:${safeSupportEmail}" style="color:#d86f00;text-decoration:underline;">Contact Boo support</a>`
    : 'Contact Boo support';
  const supportText = supportEmail
    ? `Contact Boo support at ${supportEmail}.`
    : 'Contact Boo support if you need help.';

  const text = [
    'Boo Pet Care',
    '',
    safeHeading,
    safeExplanation,
    '',
    `Your six-digit code: ${safeCode}`,
    `This code expires in ${minutes} minutes.`,
    'Boo staff will never ask you for this code.',
    safeUnrequested,
    '',
    'Boo Pet Care - Nairobi, Kenya',
    supportText,
    'This is an automated security email from Boo Pet Care.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${safeHeading}</title>
    <style>
      @media screen and (max-width: 620px) {
        .email-shell { width: 100% !important; }
        .email-card { padding: 28px 20px !important; }
        .email-heading { font-size: 30px !important; line-height: 1.15 !important; }
        .email-code { font-size: 38px !important; }
        .email-row-text { font-size: 15px !important; }
      }
    </style>
  </head>
  <body style="margin:0;background:#fffaf3;color:#292522;font-family:Arial,Helvetica,sans-serif;color-scheme:light;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fffaf3;">
      <tr><td align="center" style="padding:24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="email-shell" style="max-width:600px;background:#ffffff;border:1px solid #f0e3d3;border-radius:18px;">
          <tr><td style="padding:28px 32px 22px;border-bottom:1px solid #f2d6b5;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="font-size:28px;font-weight:700;color:#ff8700;vertical-align:middle;"><span style="font-size:30px;line-height:1;vertical-align:-2px;">&#x1F43E;</span>&nbsp;Boo</td>
              <td align="right" style="vertical-align:middle;">
                <!-- TODO(Boo artwork): Replace this text placeholder with the approved hosted Boo artwork. -->
                <span style="display:inline-block;padding:12px 10px;border:1px dashed #d9b27a;border-radius:8px;color:#806647;font-size:11px;font-weight:700;text-align:center;">BOO<br>CARE</span>
              </td>
            </tr></table>
          </td></tr>
          <tr><td class="email-card" style="padding:42px 42px 32px;">
            <h1 class="email-heading" style="margin:0;text-align:center;color:#292522;font-size:42px;line-height:1.15;font-weight:700;">${safeHeading}</h1>
            <p style="margin:22px auto 28px;max-width:470px;text-align:center;color:#292522;font-size:18px;line-height:1.45;">${safeExplanation}</p>
            <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:480px;border:2px solid #ff8700;border-radius:14px;background:#fffdf9;">
              <tr><td class="email-code" aria-label="Six digit code ${safeCode}" style="padding:22px 12px;text-align:center;color:#ff8700;font-size:52px;line-height:1;font-weight:700;letter-spacing:0;user-select:all;"><span>${safeFirst}</span><span style="display:inline-block;margin-left:14px;">${safeSecond}</span></td></tr>
            </table>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:480px;margin:28px auto 0;">
              <tr><td style="width:42px;vertical-align:top;color:#ff8700;font-size:25px;">&#x23F1;</td><td class="email-row-text" style="padding:2px 0 18px;color:#292522;font-size:17px;line-height:1.4;">This code expires in ${minutes} minutes.</td></tr>
              <tr><td style="width:42px;vertical-align:top;color:#507d51;font-size:25px;">&#x2713;</td><td class="email-row-text" style="padding:2px 0 18px;color:#292522;font-size:17px;line-height:1.4;">Boo staff will never ask you for this code.</td></tr>
              <tr><td style="width:42px;vertical-align:top;color:#ff8700;font-size:25px;">&#x24D8;</td><td class="email-row-text" style="padding:2px 0;color:#292522;font-size:17px;line-height:1.4;">${safeUnrequested}</td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:22px 32px 28px;border-top:1px solid #f2d6b5;background:#fffaf3;text-align:center;">
            <p style="margin:0 0 10px;color:#292522;font-size:16px;font-weight:700;">Boo Pet Care - Nairobi, Kenya</p>
            <p style="margin:0 0 10px;color:#292522;font-size:15px;line-height:1.4;">${supportHtml}</p>
            <p style="margin:0;color:#507d51;font-size:14px;line-height:1.4;">This is an automated security email from Boo Pet Care.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}
