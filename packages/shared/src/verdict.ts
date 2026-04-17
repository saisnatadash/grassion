import type { Verdict } from './types.js'

export function verdictLabel(v: Verdict): string {
  switch (v) {
    case 'net_positive':
      return 'Net positive'
    case 'net_negative':
      return 'Net negative'
    case 'unclear':
      return 'Unclear'
    case 'insufficient_data':
      return 'Not enough data yet'
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
