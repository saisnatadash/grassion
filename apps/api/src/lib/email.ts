import nodemailer from 'nodemailer'
import { Resend } from 'resend'
import { env } from '../env.js'

let _resend: Resend | undefined
function resendClient(): Resend {
  if (!_resend) _resend = new Resend(env().RESEND_API_KEY ?? process.env['RESEND_API_KEY'])
  return _resend
}

export interface DigestEmailData {
  teamName: string
  weekStart: Date
  totalPrs: number
  aiPrs: number
  netDollar: number
  verdict: 'net_positive' | 'net_negative' | 'unclear' | 'insufficient_data'
  speedDeltaPercent: number
  totalSeats: number
  activeSeats: number
  monthlyWaste: number
  inactiveUsers: string[]
  problemPrs: Array<{ number: number; title: string; reason: string; url: string }>
  dashboardUrl: string
}

function createZohoTransport() {
  const e = env()
  return nodemailer.createTransport({
    host: e.ZOHO_SMTP_HOST,
    port: e.ZOHO_SMTP_PORT,
    secure: e.ZOHO_SMTP_PORT === 465,
    auth: { user: e.ZOHO_SMTP_USER, pass: e.ZOHO_SMTP_PASS },
  })
}

export async function sendWeeklyDigestEmail(to: string, data: DigestEmailData): Promise<void> {
  const transport = createZohoTransport()
  await transport.sendMail({
    from: `Grassion <${env().ZOHO_FROM_ADDRESS}>`,
    to,
    subject: buildDigestSubject(data.verdict),
    text: buildDigestText(data),
    html: buildDigestHtml(data),
  })
}

function buildDigestSubject(verdict: DigestEmailData['verdict']): string {
  const emoji = verdict === 'net_positive' ? '✅' : verdict === 'net_negative' ? '⚠️' : '➖'
  return `Grassion weekly: ${emoji} Your AI ROI report`
}

function buildDigestText(data: DigestEmailData): string {
  const esc = (s: string) => s
  const verdictLine =
    data.verdict === 'net_positive'
      ? `✅ Net positive: +$${data.netDollar.toFixed(0)} estimated this week.`
      : data.verdict === 'net_negative'
        ? `⚠️ Net negative: -$${Math.abs(data.netDollar).toFixed(0)} estimated this week.`
        : data.verdict === 'unclear'
          ? `➖ Unclear — not enough signal to call it.`
          : `⏳ Not enough data yet.`

  const seatLine = data.totalSeats > 0
    ? `\nSeat usage: ${data.activeSeats}/${data.totalSeats} seats active. Monthly waste on idle seats: ~$${data.monthlyWaste.toFixed(0)}.`
    : ''

  const inactiveSection = data.inactiveUsers.length > 0
    ? `\nInactive devs (no PR in 28d): ${data.inactiveUsers.join(', ')}`
    : ''

  const problemSection = data.problemPrs.length > 0
    ? `\n\nProblem PRs:\n${data.problemPrs.map((p) => `  • #${p.number} ${esc(p.title)} — ${esc(p.reason)}\n    ${p.url}`).join('\n')}`
    : ''

  return `Hey ${esc(data.teamName)},

Last week: ${data.totalPrs} PRs merged, ${data.aiPrs} AI-assisted. AI merged ${data.speedDeltaPercent}% faster.

${verdictLine}${seatLine}${inactiveSection}${problemSection}

Dashboard: ${data.dashboardUrl}

— Grassion`
}

function buildDigestHtml(data: DigestEmailData): string {
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)

  const verdictColor =
    data.verdict === 'net_positive' ? '#22c55e' : data.verdict === 'net_negative' ? '#ef4444' : '#6b7280'
  const verdictText =
    data.verdict === 'net_positive'
      ? `✅ Net positive: +$${data.netDollar.toFixed(0)} estimated`
      : data.verdict === 'net_negative'
        ? `⚠️ Net negative: -$${Math.abs(data.netDollar).toFixed(0)} estimated`
        : data.verdict === 'unclear'
          ? `➖ Unclear — not enough signal`
          : `⏳ Not enough data yet`

  const inactiveRows = data.inactiveUsers
    .map((login) => `<tr><td style="padding:6px 12px;color:#888888;font-size:13px;">${esc(login)}</td><td style="padding:6px 12px;color:#ef4444;text-align:right;font-size:13px;">0 PRs (28d)</td></tr>`)
    .join('')

  const problemRows = data.problemPrs
    .map((p) => `<li style="margin-bottom:10px;"><a href="${p.url}" style="color:#60a5fa;text-decoration:none;font-size:14px;">#${p.number} ${esc(p.title)}</a><br><span style="color:#888888;font-size:12px;">${esc(p.reason)}</span></li>`)
    .join('')

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,system-ui,sans-serif;color:#e5e5e5;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:32px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#111111;border-radius:12px;border:1px solid #222222;overflow:hidden;">
  <tr><td style="padding:28px 32px 20px;border-bottom:1px solid #1a1a1a;">
    <div style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#888888;">Grassion Weekly</div>
    <div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:6px;">Hey ${esc(data.teamName)},</div>
    <div style="font-size:13px;color:#888888;margin-top:4px;">Week of ${data.weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
  </td></tr>
  <tr><td style="padding:24px 32px;border-bottom:1px solid #1a1a1a;">
    <div style="font-size:20px;font-weight:700;color:${verdictColor};">${verdictText}</div>
    <div style="margin-top:12px;font-size:13px;color:#888888;">
      <strong style="color:#ffffff;">${data.totalPrs}</strong> total PRs &nbsp;·&nbsp;
      <strong style="color:#ffffff;">${data.aiPrs}</strong> AI-assisted &nbsp;·&nbsp;
      <strong style="color:#ffffff;">${data.speedDeltaPercent}%</strong> faster merge
    </div>
  </td></tr>
  ${data.totalSeats > 0 ? `
  <tr><td style="padding:20px 32px;border-bottom:1px solid #1a1a1a;">
    <div style="font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#555555;margin-bottom:14px;">Seat Usage</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="text-align:center;padding:14px 8px;background:#0a0a0a;border-radius:8px;border:1px solid #1a1a1a;">
          <div style="font-size:22px;font-weight:700;color:#ffffff;">${data.totalSeats}</div>
          <div style="font-size:11px;color:#888888;margin-top:2px;">Total seats</div>
        </td>
        <td width="8"></td>
        <td style="text-align:center;padding:14px 8px;background:#0a0a0a;border-radius:8px;border:1px solid #1a1a1a;">
          <div style="font-size:22px;font-weight:700;color:#22c55e;">${data.activeSeats}</div>
          <div style="font-size:11px;color:#888888;margin-top:2px;">Active (28d)</div>
        </td>
        <td width="8"></td>
        <td style="text-align:center;padding:14px 8px;background:#0a0a0a;border-radius:8px;border:1px solid #1a1a1a;">
          <div style="font-size:22px;font-weight:700;color:#ef4444;">${data.totalSeats - data.activeSeats}</div>
          <div style="font-size:11px;color:#888888;margin-top:2px;">Idle seats</div>
        </td>
        <td width="8"></td>
        <td style="text-align:center;padding:14px 8px;background:#0a0a0a;border-radius:8px;border:1px solid #1a1a1a;">
          <div style="font-size:22px;font-weight:700;color:#f59e0b;">$${data.monthlyWaste.toFixed(0)}</div>
          <div style="font-size:11px;color:#888888;margin-top:2px;">Monthly waste</div>
        </td>
      </tr>
    </table>
    ${data.inactiveUsers.length > 0 ? `
    <div style="margin-top:16px;">
      <div style="font-size:12px;color:#555555;margin-bottom:8px;">Inactive devs — no merged PR in 28 days</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;border-radius:6px;border:1px solid #1a1a1a;">${inactiveRows}</table>
    </div>` : ''}
  </td></tr>` : ''}
  ${data.problemPrs.length > 0 ? `
  <tr><td style="padding:20px 32px;border-bottom:1px solid #1a1a1a;">
    <div style="font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#555555;margin-bottom:12px;">Problem PRs</div>
    <ul style="margin:0;padding-left:16px;color:#e5e5e5;">${problemRows}</ul>
  </td></tr>` : ''}
  <tr><td style="padding:24px 32px;">
    <a href="${data.dashboardUrl}" style="display:inline-block;background:#22c55e;color:#000000;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;text-decoration:none;">View full dashboard →</a>
  </td></tr>
  <tr><td style="padding:16px 32px;border-top:1px solid #1a1a1a;background:#0d0d0d;">
    <div style="font-size:12px;color:#444444;">Sent by Grassion · <a href="${data.dashboardUrl.replace('/dashboard', '/settings')}" style="color:#555555;">Manage digest settings</a></div>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

const FROM = 'Grassion <info@grassion.com>'

export async function sendWelcomeEmail(to: string, username: string): Promise<void> {
  const subject = 'Welcome to Grassion'
  const html = buildWelcomeHtml(username)
  try {
    await resendClient().emails.send({ from: FROM, to, subject, html })
  } catch (resendErr) {
    // Resend fails when grassion.com domain is not verified — fall back to Zoho SMTP
    const transport = createZohoTransport()
    await transport.sendMail({
      from: `Grassion <${env().ZOHO_FROM_ADDRESS}>`,
      to,
      subject,
      html,
    })
  }
}

function buildWelcomeHtml(username: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to Grassion</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#111111;border:1px solid #222222;border-radius:12px;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 24px;border-bottom:1px solid #1a1a1a;">
              <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">Grassion</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              <p style="margin:0 0 16px;font-size:24px;font-weight:600;color:#ffffff;line-height:1.3;">
                Welcome, @${username}!
              </p>
              <p style="margin:0 0 16px;font-size:15px;color:#888888;line-height:1.6;">
                You're now connected to Grassion — the tool that tells you whether your team's AI coding spend is actually paying off.
              </p>
              <p style="margin:0 0 24px;font-size:15px;color:#888888;line-height:1.6;">
                Here's what to do next:
              </p>

              <!-- Steps -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:12px 16px;background:#0a0a0a;border:1px solid #222222;border-radius:8px;margin-bottom:8px;">
                    <span style="font-size:13px;font-weight:600;color:#22c55e;">1 &nbsp;</span>
                    <span style="font-size:13px;color:#cccccc;">Install the Grassion GitHub App on your repositories</span>
                  </td>
                </tr>
                <tr><td style="height:8px;"></td></tr>
                <tr>
                  <td style="padding:12px 16px;background:#0a0a0a;border:1px solid #222222;border-radius:8px;">
                    <span style="font-size:13px;font-weight:600;color:#22c55e;">2 &nbsp;</span>
                    <span style="font-size:13px;color:#cccccc;">Set your monthly AI spend in Settings for accurate ROI</span>
                  </td>
                </tr>
                <tr><td style="height:8px;"></td></tr>
                <tr>
                  <td style="padding:12px 16px;background:#0a0a0a;border:1px solid #222222;border-radius:8px;">
                    <span style="font-size:13px;font-weight:600;color:#22c55e;">3 &nbsp;</span>
                    <span style="font-size:13px;color:#cccccc;">Merge a few PRs — your ROI verdict appears after 5 merges</span>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
                <tr>
                  <td>
                    <a href="https://app.grassion.com/dashboard"
                       style="display:inline-block;background:#22c55e;color:#000000;font-size:14px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;">
                      Open Dashboard
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #1a1a1a;">
              <p style="margin:0;font-size:12px;color:#555555;line-height:1.5;">
                You received this email because you signed up for Grassion.<br />
                Questions? Reply to this email or contact
                <a href="mailto:info@grassion.com" style="color:#888888;text-decoration:none;">info@grassion.com</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export async function sendPlanUpgradeEmail(
  to: string,
  params: { username: string; plan: string; seatCount?: number },
): Promise<void> {
  const { username, plan, seatCount } = params
  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1)
  const seatLine = seatCount != null
    ? `<p style="margin:0 0 16px;font-size:15px;color:#888888;line-height:1.6;">Your plan covers <strong style="color:#ffffff;">${seatCount} seat${seatCount === 1 ? '' : 's'}</strong>. Head to Settings to manage your team.</p>`
    : ''

  await resendClient().emails.send({
    from: FROM,
    to,
    subject: `Your Grassion ${planLabel} plan is now active ✅`,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#111111;border:1px solid #222222;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:32px 40px 24px;border-bottom:1px solid #1a1a1a;">
              <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">Grassion</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;">
              <p style="margin:0 0 16px;font-size:24px;font-weight:600;color:#ffffff;line-height:1.3;">
                Payment confirmed, @${username}!
              </p>
              <p style="margin:0 0 16px;font-size:15px;color:#888888;line-height:1.6;">
                Your <strong style="color:#22c55e;">${planLabel}</strong> plan is now active. You have full access to AI ROI analytics, seat waste intelligence, and weekly digest emails.
              </p>
              ${seatLine}
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
                <tr>
                  <td>
                    <a href="https://app.grassion.com/dashboard"
                       style="display:inline-block;background:#22c55e;color:#000000;font-size:14px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;">
                      Go to Dashboard →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #1a1a1a;">
              <p style="margin:0;font-size:12px;color:#555555;line-height:1.5;">
                Questions about your plan? Reply to this email or contact
                <a href="mailto:info@grassion.com" style="color:#888888;text-decoration:none;">info@grassion.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  })
}

export async function sendTestEmail(to: string, username: string): Promise<void> {
  await resendClient().emails.send({
    from: FROM,
    to,
    subject: 'Grassion — test email ✅',
    html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#111111;border:1px solid #222222;border-radius:12px;overflow:hidden;">
        <tr>
          <td style="padding:32px 40px 24px;border-bottom:1px solid #1a1a1a;">
            <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">Grassion</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <p style="margin:0 0 12px;font-size:20px;font-weight:600;color:#ffffff;">Test email confirmed ✅</p>
            <p style="margin:0;font-size:15px;color:#888888;line-height:1.6;">
              Hi @${username}, this is a test email from your Grassion instance. Resend is correctly configured and delivering to this address.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #1a1a1a;">
            <p style="margin:0;font-size:12px;color:#555555;">Sent from the Grassion admin panel.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })
}
