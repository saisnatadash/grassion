import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM = 'Grassion <info@grassion.com>'

export async function sendWelcomeEmail(to: string, username: string): Promise<void> {
  await resend.emails.send({
    from: FROM,
    to,
    subject: 'Welcome to Grassion 🎉',
    html: `<!DOCTYPE html>
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
                Welcome, @${username}! 🎉
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
                      Open Dashboard →
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
</html>`,
  })
}
