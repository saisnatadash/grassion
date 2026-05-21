import type { Verdict } from './types.js'

export function verdictLabel(v: Verdict): string {
  switch (v) {
    case 'net_positive':
      return 'ROI Positive'
    case 'net_negative':
      return 'ROI Negative'
    case 'unclear':
      return 'Breaking Even'
    case 'insufficient_data':
      return 'Awaiting data'
  }
}

export function verdictColor(v: Verdict): 'green' | 'red' | 'gray' | 'yellow' {
  switch (v) {
    case 'net_positive':
      return 'green'
    case 'net_negative':
      return 'red'
    case 'unclear':
      return 'yellow'
    case 'insufficient_data':
      return 'gray'
  }
}

export function verdictEmoji(v: Verdict): string {
  switch (v) {
    case 'net_positive':
      return '✅'
    case 'net_negative':
      return '⚠️'
    case 'unclear':
      return '➖'
    case 'insufficient_data':
      return '⏳'
  }
}
