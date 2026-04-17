# packages/shared/src

Source root.

If you add a new file, re-export it from `index.ts`. Imports from this package go through the package root only (`from '@grassion/shared'`), never deep paths.

## Date math

`startOfWeekUtc(d)` returns the Monday 00:00 UTC of the week containing `d`. The worker uses this to key `team_weekly_metrics`. The dashboard's "this week" is the same key.

`hoursBetween(a, b) = (b - a) / 3_600_000`. We always express PR durations in hours.
