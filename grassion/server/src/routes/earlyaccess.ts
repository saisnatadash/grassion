import { Router, Request, Response } from 'express';
import * as db from '../lib/db';
import { sendEarlyAccessConfirmation } from '../lib/mailer';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const { email, name, company, role, use_case } = req.body as {
      email: string; name?: string; company?: string; role?: string; use_case?: string;
    };
    if (!email) { res.status(400).json({ error: 'Email required' }); return; }

    const result = await db.query(
      `INSERT INTO early_access(email, name, company, role, use_case)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name, updated_at=NOW()
       RETURNING id`,
      [email.toLowerCase(), name || null, company || null, role || null, use_case || null]
    );

    try {
      await sendEarlyAccessConfirmation(email, name || email.split('@')[0]);
    } catch { /* email optional in dev */ }

    await db.query(
      `INSERT INTO audit_log(action, resource, meta, ip) VALUES('early_access','early_access',$1,$2)`,
      [JSON.stringify({ email, id: result.rows[0].id }), req.ip]
    );

    res.status(201).json({ ok: true, message: "You're on the list! Check your email." });
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err.code === '23505') { res.status(409).json({ error: 'Already on the list!' }); return; }
    res.status(500).json({ error: 'Failed to join' });
  }
});

export default router;
