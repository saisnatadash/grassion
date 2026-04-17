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
  const verdictColor =
    data.verdict === 'net_positive' ? '#15803d' : data.verdict === 'net_negative' ? '#b91c1c' : '#6b7280'
  const escape = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!)
  const verdictText =
    data.verdict === 'net_positive'
      ? `Net positive this week: +$${data.netDollar.toFixed(0)} estimated.`
      : data.verdict === 'net_negative'
        ? `Net negative this week: -$${Math.abs(data.netDollar).toFixed(0)} estimated.`
        : data.verdict === 'unclear'
          ? `Unclear this week. Not enough signal to call it.`
          : `Not enough data yet.`
  const problemRows = data.problemPrs
    .map(
      (p) =>
        `<li style="margin-bottom:6px;"><a href="${p.url}" style="color:#0369a1;">#${p.number} ${escape(p.title)}</a> — ${escape(p.reason)}</li>`,
    )
    .join('')
  return `<!doctype html>
<html><body style="font-family:-apple-system,system-ui,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px;">
<h2 style="margin:0 0 12px;">Hey ${escape(data.teamName)},</h2>
<p>Last week your team merged <strong>${data.totalPrs}</strong> PRs. <strong>${data.aiPrs}</strong> were AI-assisted.</p>
<p>AI PRs merged <strong>${data.speedDeltaPercent}%</strong> faster than human PRs, but had a <strong>${data.reworkMultiplier}×</strong> rework rate.</p>
<p style="font-size:18px;font-weight:600;color:${verdictColor};">${verdictText}</p>
${data.problemPrs.length > 0 ? `<h3 style="margin-top:24px;">Problem PRs worth reviewing</h3><ul>${problemRows}</ul>` : ''}
<p style="margin-top:32px;"><a href="${data.dashboardUrl}" style="background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block;">View dashboard</a></p>
<hr style="margin:32px 0;border:none;border-top:1px solid #e5e7eb;" />
<p style="color:#6b7280;font-size:13px;">Reply STOP to pause these digests. Change your AI spend estimate in settings to improve accuracy.</p>
</body></html>`
}
