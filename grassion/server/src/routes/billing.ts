import { Router, Request, Response } from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import * as db from '../lib/db';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

function getRazorpay(): Razorpay {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  });
}

const PLANS: Record<string, { amount: number; name: string }> = {
  pro:  { amount: 290000, name: 'Grassion Pro'  },
  team: { amount: 990000, name: 'Grassion Team' },
};

router.post('/order', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { plan } = req.body as { plan: string };
    const planData = PLANS[plan];
    if (!planData) { res.status(400).json({ error: 'Invalid plan' }); return; }

    const razorpay = getRazorpay();
    const order = await razorpay.orders.create({
      amount: planData.amount,
      currency: 'INR',
      receipt: `order_${req.user!.id}_${Date.now()}`,
      notes: { plan, user_id: String(req.user!.id) },
    });

    await db.query(
      `INSERT INTO payments(user_id, razorpay_order_id, amount, currency, plan, status)
       VALUES($1,$2,$3,'INR',$4,'pending')`,
      [req.user!.id, order.id, planData.amount, plan]
    );

    res.json({
      order_id: order.id,
      amount: planData.amount,
      currency: 'INR',
      name: planData.name,
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch {
    res.status(500).json({ error: 'Order creation failed' });
  }
});

router.post('/verify', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body as {
      razorpay_order_id: string;
      razorpay_payment_id: string;
      razorpay_signature: string;
      plan: string;
    };

    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
      .update(body)
      .digest('hex');

    if (expectedSig !== razorpay_signature) {
      res.status(400).json({ error: 'Payment verification failed' });
      return;
    }

    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 1);

    await db.query(
      `UPDATE users SET plan=$1, subscription_status='active', subscription_end_date=$2 WHERE id=$3`,
      [plan, endDate, req.user!.id]
    );

    await db.query(
      `UPDATE payments SET razorpay_payment_id=$1, status='success' WHERE razorpay_order_id=$2`,
      [razorpay_payment_id, razorpay_order_id]
    );

    await db.query(
      `INSERT INTO audit_log(user_id, action, resource, meta) VALUES($1,'payment_success','payments',$2)`,
      [req.user!.id, JSON.stringify({ plan, payment_id: razorpay_payment_id })]
    );

    res.json({ ok: true, plan });
  } catch {
    res.status(500).json({ error: 'Verification failed' });
  }
});

router.get('/status', requireAuth, async (req: AuthRequest, res: Response) => {
  const result = await db.query(
    `SELECT plan, subscription_status, subscription_end_date FROM users WHERE id=$1`,
    [req.user!.id]
  );
  res.json(result.rows[0] || { plan: 'free', subscription_status: 'inactive' });
});

export default router;
