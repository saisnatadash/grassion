const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.zoho.in',
  port: 465,
  secure: true,
  auth: { user: process.env.ZOHO_EMAIL, pass: process.env.ZOHO_PASSWORD }
});

async function sendWelcomeEmail(to, username) {
  await transporter.sendMail({
    from: `"Grassion" <${process.env.ZOHO_EMAIL}>`,
    to, subject: 'Welcome to Grassion — Ship fearlessly.',
    html: `<h2>Welcome ${username}!</h2><p>Your codebase now has a silent security guard.</p><a href="https://grassion.com/dashboard">Go to Dashboard</a>`
  });
}

async function sendScanCompleteEmail(to, username, repo, issueCount) {
  await transporter.sendMail({
    from: `"Grassion" <${process.env.ZOHO_EMAIL}>`,
    to, subject: `Scan complete — ${issueCount} issue${issueCount !== 1 ? 's' : ''} found in ${repo}`,
    html: `<h2>Scan Complete</h2><p>Found <strong>${issueCount} unprotected endpoint${issueCount !== 1 ? 's' : ''}</strong> in ${repo}.</p><a href="https://grassion.com/dashboard">View Results</a>`
  });
}

async function sendPRRaisedEmail(to, username, repo, prUrl) {
  await transporter.sendMail({
    from: `"Grassion" <${process.env.ZOHO_EMAIL}>`,
    to, subject: `Fix PR raised for ${repo}`,
    html: `<h2>Fix PR Raised 🛡️</h2><p>Grassion raised a fix PR for <strong>${repo}</strong>.</p><a href="${prUrl}">Review PR on GitHub</a>`
  });
}

module.exports = { sendWelcomeEmail, sendScanCompleteEmail, sendPRRaisedEmail };
