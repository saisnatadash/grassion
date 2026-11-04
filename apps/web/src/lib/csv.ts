export function downloadCsv(rows: Array<Record<string, unknown>>, cols: string[], filename: string) {
  const header = cols.join(',')
  const lines = rows.map((r) =>
    cols
      .map((c) => {
        const v = r[c] ?? ''
        const s = String(v).replace(/"/g, '""')
        return /[",\n]/.test(s) ? `"${s}"` : s
      })
      .join(','),
  )
  const csv = [header, ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
