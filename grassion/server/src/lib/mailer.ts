import nodemailer from 'nodemailer';

function getTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.zoho.in',
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: true,
    auth: {
      user: process.env.SMTP_USER || 'info@grassion.com',
      pass: process.env.SMTP_PASS || '',
    },
  });
}

export async function sendVerification(email: string, name: string, token: string): Promise<void> {
  const url = `${process.env.APP_URL}/api/auth/verify?token=${token}`;
  const transporter = getTransport();
  await transporter.sendMail({
    from: '"Grassion" <info@grassion.com>',
    to: email,
    subject: 'Verify your Grassion account',
    html: `
      <div style="font-family: 'DM Sans', sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; color: #1a1a2e;">
        <h2 style="font-size: 24px; font-weight: 600; margin-bottom: 8px;">Welcome, ${name} 👋</h2>
        <p style="color: #555; margin-bottom: 24px;">Click the button below to verify your email and activate your Grassion account.</p>
        <a href="${url}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#6c63ff,#48cfad);color:#fff;border-radius:12px;text-decoration:none;font-weight:600;">Verify Email</a>
        <p style="margin-top: 24px; font-size: 12px; color: #aaa;">If you didn't sign up, ignore this email.</p>
      </div>
    `,
  });
}

export async function sendEarlyAccessConfirmation(email: string, name: string): Promise<void> {
  const transporter = getTransport();
  await transporter.sendMail({
    from: '"Grassion" <info@grassion.com>',
    to: email,
    subject: "You're on the Grassion waitlist 🚀",
    html: `
      <div style="font-family: 'DM Sans', sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; color: #1a1a2e;">
        <h2 style="font-size: 24px; font-weight: 600;">Thanks ${name}! You're in 🎉</h2>
        <p style="color: #555; margin-bottom: 16px;">You've successfully joined the Grassion early access list. We'll reach out as soon as your spot is ready.</p>
        <p style="color: #555;">In the meantime, share Grassion with your team.</p>
        <p style="margin-top: 32px; font-size: 13px; color: #888;">— The Grassion Team</p>
      </div>
    `,
  });
}

export async function sendPasswordReset(email: string, token: string): Promise<void> {
  const url = `${process.env.APP_URL}/reset-password?token=${token}`;
  const transporter = getTransport();
  await transporter.sendMail({
    from: '"Grassion" <info@grassion.com>',
    to: email,
    subject: 'Reset your Grassion password',
    html: `
      <div style="font-family: 'DM Sans', sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; color: #1a1a2e;">
        <h2 style="font-size: 24px; font-weight: 600;">Password Reset</h2>
        <p style="color: #555; margin-bottom: 24px;">Click the button below to reset your password. This link expires in 1 hour.</p>
        <a href="${url}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#6c63ff,#48cfad);color:#fff;border-radius:12px;text-decoration:none;font-weight:600;">Reset Password</a>
      </div>
    `,
  });
}
