import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';
import rateLimit from 'express-rate-limit';
import * as db from './lib/db';

import authRouter      from './routes/auth';
import githubRouter    from './routes/github';
import billingRouter   from './routes/billing';
import earlyRouter     from './routes/earlyaccess';
import contactRouter   from './routes/contact';
import dashboardRouter from './routes/dashboard';

const app = express();
const PORT = parseInt(process.env.PORT || '8080', 10);

app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Static files
app.use(express.static(path.join(__dirname, '../../web/public')));

// API routes
app.use('/api/auth',         authRouter);
app.use('/api/github',       githubRouter);
app.use('/api/billing',      billingRouter);
app.use('/api/early-access', earlyRouter);
app.use('/api/contact',      contactRouter);
app.use('/api/dashboard',    dashboardRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date(), version: '2.0.0' }));

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../web/public/index.html'));
});

app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

async function start(): Promise<void> {
  await db.connect();  console.log('✓ DB connected');
  await db.migrate();  console.log('✓ Tables ready');
  app.listen(PORT, () => console.log(`✓ Grassion running on port ${PORT}`));
}

start().catch(e => { console.error(e); process.exit(1); });
