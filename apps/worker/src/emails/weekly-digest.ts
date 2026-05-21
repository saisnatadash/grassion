import type { Verdict } from '@grassion/shared'

export interface DigestProblemPr {
  number: number
  title: string
  reason: string
  url: string
}

export interface DigestData {
  teamName: string
  weekStart: Date
  totalPrs: number
  aiPrs: number
  speedDeltaPercent: number
  reworkMultiplier: number
  netDollar: number
  verdict: Verdict
  problemPrs: DigestProblemPr[]
  dashboardUrl: string
  totalSeats?: number
  activeSeats?: number
  monthlyWaste?: number
  inactiveUsers?: string[]
}

export function weeklyDigestText(data: DigestData): string {
  const verdictLine =
    data.verdict === 'net_positive'
      ? `✅ Net positive this week: +$${data.netDollar.toFixed(0)} estimated.`
      : data.verdict === 'net_negative'
        ? `⚠️ Net negative this week: -$${Math.abs(data.netDollar).toFixed(0)} estimated.`
        : data.verdict === 'unclear'
          ? `➖ Unclear this week. Not enough signal to call it.`
          : `⏳ Not enough data yet.`

  const problemSection =
    data.problemPrs.length > 0
      ? `\n\nProblem PRs worth reviewing:\n${data.problemPrs
          .map((p) => `  • #${p.number} ${p.title} — ${p.reason}\n    ${p.url}`)
          .join('\n')}`
      : ''

  return `Hey ${data.teamName},

Last week your team merged ${data.totalPrs} PRs. ${data.aiPrs} were AI-assisted.

AI PRs merged ${data.speedDeltaPercent}% faster than human PRs, but had a ${data.reworkMultiplier}× rework rate.

${verdictLine}${problemSection}

See full dashboard: ${data.dashboardUrl}

— Grassion

---
Reply STOP to pause these digests. Change your AI spend estimate in settings to improve accuracy.`
}

export function weeklyDigestSubject(data: { verdict: Verdict }): string {
  const emoji =
    data.verdict === 'net_positive' ? '✅' : data.verdict === 'net_negative' ? '⚠️' : '➖'
  return `Grassion weekly: ${emoji} Your AI ROI report`
}

export function weeklyDigestHtml(data: DigestData): string {
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

  const totalSeats = data.totalSeats ?? 0
  const activeSeats = data.activeSeats ?? 0
  const monthlyWaste = data.monthlyWaste ?? 0
  const inactiveUsers = data.inactiveUsers ?? []

  const inactiveRows = inactiveUsers
    .map((login) => `<tr><td style="padding:6px 12px;color:#888888;font-size:13px;">${esc(login)}</td><td style="padding:6px 12px;color:#ef4444;text-align:right;font-size:13px;">0 PRs (28d)</td></tr>`)
    .join('')

  const problemRows = data.problemPrs
    .map((p) => `<li style="margin-bottom:10px;"><a href="${p.url}" style="color:#60a5fa;text-decoration:none;font-size:14px;">#${p.number} ${esc(p.title)}</a><br><span style="color:#888888;font-size:12px;">${esc(p.reason)}</span></li>`)
    .join('')

  const seatBlock = totalSeats > 0 ? `
  <tr><td style="padding:20px 32px;border-bottom:1px solid #1a1a1a;">
    <div style="font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#555555;margin-bottom:14px;">Seat Usage</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="text-align:center;padding:14px 8px;background:#0a0a0a;border-radius:8px;border:1px solid #1a1a1a;">
          <div style="font-size:22px;font-weight:700;color:#ffffff;">${totalSeats}</div>
          <div style="font-size:11px;color:#888888;margin-top:2px;">Total seats</div>
        </td>
        <td width="8"></td>
        <td style="text-align:center;padding:14px 8px;background:#0a0a0a;border-radius:8px;border:1px solid #1a1a1a;">
          <div style="font-size:22px;font-weight:700;color:#22c55e;">${activeSeats}</div>
          <div style="font-size:11px;color:#888888;margin-top:2px;">Active (28d)</div>
        </td>
        <td width="8"></td>
        <td style="text-align:center;padding:14px 8px;background:#0a0a0a;border-radius:8px;border:1px solid #1a1a1a;">
          <div style="font-size:22px;font-weight:700;color:#ef4444;">${totalSeats - activeSeats}</div>
          <div style="font-size:11px;color:#888888;margin-top:2px;">Idle seats</div>
        </td>
        <td width="8"></td>
        <td style="text-align:center;padding:14px 8px;background:#0a0a0a;border-radius:8px;border:1px solid #1a1a1a;">
          <div style="font-size:22px;font-weight:700;color:#f59e0b;">$${monthlyWaste.toFixed(0)}</div>
          <div style="font-size:11px;color:#888888;margin-top:2px;">Monthly waste</div>
        </td>
      </tr>
    </table>
    ${inactiveUsers.length > 0 ? `
    <div style="margin-top:16px;">
      <div style="font-size:12px;color:#555555;margin-bottom:8px;">Inactive devs — no merged PR in 28 days</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;border-radius:6px;border:1px solid #1a1a1a;">${inactiveRows}</table>
    </div>` : ''}
  </td></tr>` : ''

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
      <strong style="color:#ffffff;">${data.speedDeltaPercent}%</strong> faster merge &nbsp;·&nbsp;
      <strong style="color:#ffffff;">${data.reworkMultiplier}×</strong> rework rate
    </div>
  </td></tr>
  ${seatBlock}
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
