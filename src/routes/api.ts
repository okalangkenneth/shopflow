import { Router, Request, Response } from 'express';
import { supabase } from '../db/client';
import { getQueueHealth } from '../queues';
import { logger } from '../utils/logger';

export const apiRouter = Router();

// ─── Health Check ─────────────────────────────────────────────────────────────

apiRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    const queueHealth = await getQueueHealth();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      queues: queueHealth,
    });
  } catch (err: any) {
    res.status(503).json({ status: 'degraded', error: err.message });
  }
});

// ─── Orders ───────────────────────────────────────────────────────────────────

apiRouter.get('/orders', async (req: Request, res: Response) => {
  const { status, limit = '20', offset = '0' } = req.query;

  let query = supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error, count } = await query;

  if (error) {
    logger.error('Failed to fetch orders', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch orders' });
    return;
  }

  res.json({ orders: data, total: count, limit: Number(limit), offset: Number(offset) });
});

apiRouter.get('/orders/:id', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error || !data) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  res.json(data);
});

// ─── Inventory ────────────────────────────────────────────────────────────────

apiRouter.get('/inventory', async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('inventory')
    .select('*')
    .order('title', { ascending: true });

  if (error) {
    res.status(500).json({ error: 'Failed to fetch inventory' });
    return;
  }

  res.json({ items: data });
});

// ─── Job Logs ─────────────────────────────────────────────────────────────────

apiRouter.get('/jobs', async (req: Request, res: Response) => {
  const { order_id, status } = req.query;

  let query = supabase
    .from('job_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (order_id) query = query.eq('order_id', order_id);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;

  if (error) {
    res.status(500).json({ error: 'Failed to fetch job logs' });
    return;
  }

  res.json({ jobs: data });
});
