export interface DarkCodeDigestData {
  teamName: string
  darkPct: number
  prevDarkPct: number | null
  totalAreas: number
  darkAreas: number
  criticalDarkAreas: number
  singlePersonAreas: number
  newFragileAreas: Array<{ path: string; isCritical: boolean }>
  lostCoverageAreas: Array<{ path: string; lastPerson: string }>
  appUrl: string
}

export function darkCodeDigestSubject(data: DarkCodeDigestData): string {
  const trend = data.prevDarkPct === null ? '' :
    data.darkPct > data.prevDarkPct ? ' ↑' : data.darkPct < data.prevDarkPct ? ' ↓' : ''
  return `[Grassion] Dark Code Report — ${data.darkPct}%${trend} dark areas this week`
}

export function darkCodeDigestText(data: DarkCodeDigestData): string {
  const lines: string[] = [
    `Dark Code Weekly Digest — ${data.teamName}`,
    '='.repeat(50),
    '',
    `Dark areas: ${data.darkAreas}/${data.totalAreas} (${data.darkPct}%)${
      data.prevDarkPct !== null
        ? ` — was ${data.prevDarkPct}% last week`
        : ''
    }`,
  ]

  if (data.criticalDarkAreas > 0) {
    lines.push(`Critical dark areas: ${data.criticalDarkAreas}`)
  }
  if (data.singlePersonAreas > 0) {
    lines.push(`Single-person risk areas: ${data.singlePersonAreas}`)
  }

  if (data.newFragileAreas.length > 0) {
    lines.push('', 'New fragile areas this week:')
    for (const a of data.newFragileAreas) {
      lines.push(`  • ${a.path}${a.isCritical ? ' (CRITICAL)' : ''}`)
    }
  }

  if (data.lostCoverageAreas.length > 0) {
    lines.push('', 'Areas that lost their last covering person:')
    for (const a of data.lostCoverageAreas) {
      lines.push(`  • ${a.path} (last: @${a.lastPerson})`)
    }
  }

  lines.push('', `View full report: ${data.appUrl}/dark-code`)
  return lines.join('\n')
}

export function darkCodeDigestHtml(data: DarkCodeDigestData): string {
  const trendBadge =
    data.prevDarkPct === null ? '' :
    data.darkPct > data.prevDarkPct
      ? `<span style="color:#ef4444">▲ ${data.darkPct - data.prevDarkPct}%</span>`
      : data.darkPct < data.prevDarkPct
      ? `<span style="color:#22c55e">▼ ${data.prevDarkPct - data.darkPct}%</span>`
      : `<span style="color:#888">→ no change</span>`

  const newFragileRows = data.newFragileAreas.map(
    (a) => `<tr><td style="padding:4px 8px;font-family:monospace">${a.path}</td><td style="padding:4px 8px;color:${a.isCritical ? '#ef4444' : '#f59e0b'}">${a.isCritical ? '🔴 Critical' : '⚠️ Fragile'}</td></tr>`,
  ).join('')

  const lostRows = data.lostCoverageAreas.map(
    (a) => `<tr><td style="padding:4px 8px;font-family:monospace">${a.path}</td><td style="padding:4px 8px;color:#888">last: @${a.lastPerson}</td></tr>`,
  ).join('')

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;font-family:sans-serif;background:#0a0a0a;color:#e5e5e5">
  <div style="max-width:600px;margin:0 auto">
    <h2 style="color:#22c55e;margin:0 0 4px">Grassion Dark Code Report</h2>
    <p style="color:#666;margin:0 0 24px">${data.teamName}</p>

    <div style="background:#111;border:1px solid #222;border-radius:8px;padding:20px;margin-bottom:20px">
      <div style="font-size:48px;font-weight:700;color:${data.darkPct > 30 ? '#ef4444' : data.darkPct > 15 ? '#f59e0b' : '#22c55e'}">${data.darkPct}%</div>
      <div style="color:#888;margin-top:4px">of areas are dark ${trendBadge}</div>
      <div style="margin-top:12px;color:#aaa">
        ${data.darkAreas} dark / ${data.totalAreas} total areas
        ${data.criticalDarkAreas > 0 ? `<br><span style="color:#ef4444">${data.criticalDarkAreas} critical dark</span>` : ''}
        ${data.singlePersonAreas > 0 ? `<br><span style="color:#f59e0b">${data.singlePersonAreas} single-person risk</span>` : ''}
      </div>
    </div>

    ${newFragileRows ? `
    <h3 style="color:#f59e0b;margin:0 0 8px">New fragile areas</h3>
    <table style="width:100%;border-collapse:collapse;background:#111;border-radius:6px;margin-bottom:20px">
      ${newFragileRows}
    </table>` : ''}

    ${lostRows ? `
    <h3 style="color:#ef4444;margin:0 0 8px">Lost coverage</h3>
    <p style="color:#888;font-size:13px;margin:0 0 8px">Areas where the last covering person has left</p>
    <table style="width:100%;border-collapse:collapse;background:#111;border-radius:6px;margin-bottom:20px">
      ${lostRows}
    </table>` : ''}

    <a href="${data.appUrl}/dark-code" style="display:inline-block;background:#22c55e;color:#000;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600">View Full Report →</a>
    <p style="color:#444;font-size:12px;margin-top:24px">You're receiving this because your team has weekly Dark Code digests enabled. <a href="${data.appUrl}/settings" style="color:#555">Manage settings</a></p>
  </div>
</body>
</html>`
}
