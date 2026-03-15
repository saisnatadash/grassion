'use strict';
const nodemailer = require('nodemailer');

function getTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.zoho.in',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,        // use STARTTLS on 587, not SSL on 465
    requireTLS: true,
    auth: {
      user: process.env.SMTP_USER || 'info@grassion.com',
      pass: process.env.SMTP_PASS || '',
    },
    tls: {
      rejectUnauthorized: false  // prevents cert errors on Railway
    }
  });
}

const FROM = '"Grassion" <' + (process.env.SMTP_USER || 'info@grassion.com') + '>';
const APP_URL = process.env.APP_URL || 'https://grassion.com';

const baseStyle = `
  font-family:'Inter',-apple-system,sans-serif;
  max-width:520px;
  margin:0 auto;
  padding:40px 24px;
  color:#1a2b3c;
`;

async function sendVerification(email, name, token) {
  const url = `${APP_URL}/api/auth/verify?token=${token}`;
  const t = getTransport();
  await t.sendMail({
    from: FROM,
    to: email,
    subject: 'Verify your Grassion account',
    html: `<div style="${baseStyle}">
      <img src="${APP_URL}/img/logo.png" alt="Grassion" style="height:28px;margin-bottom:32px;" />
      <h2 style="font-size:22px;font-weight:800;margin-bottom:8px;letter-spacing:-.02em;">Welcome, ${name} 👋</h2>
      <p style="color:#6b8099;margin-bottom:28px;line-height:1.6;">You're almost set. Click below to verify your email and start protecting your PRs.</p>
      <a href="${url}" style="display:inline-block;padding:13px 28px;background:#1a2b3c;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Verify Email</a>
      <p style="color:#6b8099;margin-top:32px;font-size:12px;line-height:1.6;">If you didn't sign up for Grassion, you can safely ignore this email.</p>
      <hr style="border:none;border-top:1px solid rgba(42,127,165,0.15);margin:32px 0;" />
      <p style="color:#6b8099;font-size:12px;">Grassion — PR Guardrails for Engineering Teams<br/>Built in Odisha, for the world.</p>
    </div>`,
  });
}

async function sendEarlyAccessConfirmation(email, name) {
  const t = getTransport();
  await t.sendMail({
    from: FROM,
    to: email,
    subject: "You're on the Grassion waitlist",
    html: `<div style="${baseStyle}">
      <img src="${APP_URL}/img/logo.png" alt="Grassion" style="height:28px;margin-bottom:32px;" />
      <h2 style="font-size:22px;font-weight:800;margin-bottom:8px;">You're in the list 🎉</h2>
      <p style="color:#6b8099;line-height:1.6;">Thanks ${name}! You've joined the Grassion early access list. We'll reach out when your spot is ready.</p>
      <hr style="border:none;border-top:1px solid rgba(42,127,165,0.15);margin:32px 0;" />
      <p style="color:#6b8099;font-size:12px;">The Grassion Team</p>
    </div>`,
  });
}

async function sendPasswordReset(email, token) {
  const url = `${APP_URL}/reset-password?token=${token}`;
  const t = getTransport();
  await t.sendMail({
    from: FROM,
    to: email,
    subject: 'Reset your Grassion password',
    html: `<div style="${baseStyle}">
      <img src="${APP_URL}/img/logo.png" alt="Grassion" style="height:28px;margin-bottom:32px;" />
      <h2 style="font-size:22px;font-weight:800;margin-bottom:8px;">Reset your password</h2>
      <p style="color:#6b8099;margin-bottom:28px;line-height:1.6;">Click below to reset your password. This link expires in 1 hour.</p>
      <a href="${url}" style="display:inline-block;padding:13px 28px;background:#1a2b3c;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Reset Password</a>
      <p style="color:#6b8099;margin-top:32px;font-size:12px;line-height:1.6;">If you didn't request a password reset, ignore this email. Your password won't change.</p>
      <hr style="border:none;border-top:1px solid rgba(42,127,165,0.15);margin:32px 0;" />
      <p style="color:#6b8099;font-size:12px;">Grassion — PR Guardrails for Engineering Teams</p>
    </div>`,
  });
}

module.exports = { sendVerification, sendEarlyAccessConfirmation, sendPasswordReset };
