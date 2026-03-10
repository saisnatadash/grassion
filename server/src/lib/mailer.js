'use strict';
const nodemailer = require('nodemailer');

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

async function sendVerification(email, name, token) {
  const url = `${process.env.APP_URL}/api/auth/verify?token=${token}`;
  const t = getTransport();
  await t.sendMail({
    from: '"Grassion" <info@grassion.com>',
    to: email,
    subject: 'Verify your Grassion account',
    html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 24px;">
      <h2>Welcome, ${name} 👋</h2>
      <p style="color:#555;margin-bottom:24px;">Click below to verify your email.</p>
      <a href="${url}" style="display:inline-block;padding:12px 28px;background:#6c63ff;color:#fff;border-radius:12px;text-decoration:none;font-weight:600;">Verify Email</a>
    </div>`,
  });
}

async function sendEarlyAccessConfirmation(email, name) {
  const t = getTransport();
  await t.sendMail({
    from: '"Grassion" <info@grassion.com>',
    to: email,
    subject: "You're on the Grassion waitlist 🚀",
    html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 24px;">
      <h2>Thanks ${name}! You're in 🎉</h2>
      <p style="color:#555;">You've joined the Grassion early access list. We'll reach out when your spot is ready.</p>
      <p style="color:#888;margin-top:32px;font-size:13px;">— The Grassion Team</p>
    </div>`,
  });
}

async function sendPasswordReset(email, token) {
  const url = `${process.env.APP_URL}/reset-password?token=${token}`;
  const t = getTransport();
  await t.sendMail({
    from: '"Grassion" <info@grassion.com>',
    to: email,
    subject: 'Reset your Grassion password',
    html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 24px;">
      <h2>Password Reset</h2>
      <p style="color:#555;margin-bottom:24px;">Click below to reset your password. Expires in 1 hour.</p>
      <a href="${url}" style="display:inline-block;padding:12px 28px;background:#6c63ff;color:#fff;border-radius:12px;text-decoration:none;font-weight:600;">Reset Password</a>
    </div>`,
  });
}

module.exports = { sendVerification, sendEarlyAccessConfirmation, sendPasswordReset };
