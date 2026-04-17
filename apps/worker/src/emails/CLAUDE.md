# apps/worker/src/emails

Resend-backed email pipeline.

- `weekly-digest.ts` — pure body builders. Exports `weeklyDigestText`, `weeklyDigestHtml`, `weeklyDigestSubject`. No I/O.
- `send.ts` — `sendEmail({ to, subject, text, html })`. Throws on Resend error.

Keep template logic in `weekly-digest.ts` — it makes snapshots/tests easy. The HTML version intentionally uses inline styles only (most email clients ignore `<style>` tags).

## Tone

The digest is short, plain English, no marketing copy. The verdict line is the headline; the problem-PR list is the second-most-important thing. Everything else is supporting context.
