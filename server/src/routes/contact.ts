import { Router, Request, Response } from 'express';
import * as db from '../lib/db';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, email, subject, message } = req.body as {
      name: string; email: string; subject?: string; message: string;
    };
    if (!name || !email || !message) { res.status(400).json({ error: 'Name, email and message required' }); return; }

    await db.query(
      `INSERT INTO contact_messages(name, email, subject, message) VALUES($1,$2,$3,$4)`,
      [name, email.toLowerCase(), subject || null, message]
    );

    res.status(201).json({ ok: true, message: 'Message received! We will get back to you soon.' });
  } catch {
    res.status(500).json({ error: 'Failed to send message' });
  }
});

export default router;
