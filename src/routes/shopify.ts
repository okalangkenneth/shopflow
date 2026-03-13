import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Router, Request, Response } from 'express';
import { supabase } from '../db/client';
import { logger } from '../utils/logger';

export const shopifyAuthRouter = Router();

const SCOPES = process.env.SHOPIFY_SCOPES || 'read_orders,write_orders,read_inventory,write_inventory,write_fulfillments';

// ─── State Nonce (stateless HMAC-signed, no session store needed) ─────────────

function createState(shop: string): string {
  const nonce = randomBytes(8).toString('hex');
  const payload = Buffer.from(JSON.stringify({ shop, nonce, ts: Date.now() })).toString(
    'base64url'
  );
  const sig = createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
    .update(payload)
    .digest('hex');
  return `${payload}.${sig}`;
}

function verifyState(state: string, expectedShop: string): boolean {
  const dotIndex = state.lastIndexOf('.');
  if (dotIndex === -1) return false;

  const payload = state.slice(0, dotIndex);
  const sig = state.slice(dotIndex + 1);

  const expectedSig = createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
    .update(payload)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expectedSig, 'hex');
    if (a.length !== b.length) return false;
    if (!timingSafeEqual(a, b)) return false;
  } catch {
    return false;
  }

  let parsed: { shop: string; ts: number };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      shop: string;
      ts: number;
    };
  } catch {
    return false;
  }

  if (parsed.shop !== expectedShop) return false;
  // Expire state after 10 minutes
  if (Date.now() - parsed.ts > 10 * 60 * 1000) return false;

  return true;
}

// ─── Verify Shopify callback HMAC ─────────────────────────────────────────────

function verifyCallbackHmac(query: Record<string, string>): boolean {
  const { hmac, ...rest } = query;
  if (!hmac) return false;

  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('&');

  const digest = createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
    .update(message)
    .digest('hex');

  try {
    const a = Buffer.from(digest, 'hex');
    const b = Buffer.from(hmac, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── GET /auth/shopify — Begin OAuth install ──────────────────────────────────

shopifyAuthRouter.get('/auth/shopify', (req: Request, res: Response): void => {
  const shop = req.query.shop as string | undefined;

  if (!shop || !shop.endsWith('.myshopify.com')) {
    res.status(400).json({ error: 'Missing or invalid shop parameter' });
    return;
  }

  const state = createState(shop);
  const redirectUri = `${process.env.SHOPIFY_APP_URL}/auth/shopify/callback`;

  const authUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authUrl.searchParams.set('client_id', process.env.SHOPIFY_API_KEY!);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);

  logger.info('[shopifyAuth] Redirecting to Shopify OAuth', { shop });
  res.redirect(authUrl.toString());
});

// ─── GET /auth/shopify/callback — Exchange code for access token ──────────────

shopifyAuthRouter.get('/auth/shopify/callback', async (req: Request, res: Response): Promise<void> => {
  const { shop, code, state, hmac, ...rest } = req.query as Record<string, string>;

  if (!shop || !code || !state || !hmac) {
    res.status(400).json({ error: 'Missing required OAuth callback parameters' });
    return;
  }

  // 1. Verify HMAC to confirm the callback is from Shopify
  if (!verifyCallbackHmac({ shop, code, state, hmac, ...rest })) {
    logger.warn('[shopifyAuth] Callback HMAC verification failed', { shop });
    res.status(401).json({ error: 'HMAC verification failed' });
    return;
  }

  // 2. Verify state nonce to prevent CSRF
  if (!verifyState(state, shop)) {
    logger.warn('[shopifyAuth] State verification failed', { shop });
    res.status(401).json({ error: 'Invalid or expired state parameter' });
    return;
  }

  // 3. Exchange authorization code for access token
  let accessToken: string;
  let scope: string;

  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY!,
        client_secret: process.env.SHOPIFY_API_SECRET!,
        code,
      }),
    });

    if (!tokenRes.ok) {
      throw new Error(`Token exchange failed: HTTP ${tokenRes.status}`);
    }

    const tokenData = (await tokenRes.json()) as { access_token: string; scope: string };
    accessToken = tokenData.access_token;
    scope = tokenData.scope;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[shopifyAuth] Token exchange error', { shop, error: message });
    res.status(500).json({ error: 'Failed to exchange authorization code' });
    return;
  }

  // 4. Persist the session in Supabase
  const { error: upsertError } = await supabase.from('shopify_sessions').upsert(
    {
      shop,
      access_token: accessToken,
      scope,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'shop' }
  );

  if (upsertError) {
    logger.error('[shopifyAuth] Failed to save session', { shop, error: upsertError.message });
    res.status(500).json({ error: 'Failed to save session' });
    return;
  }

  logger.info('[shopifyAuth] OAuth complete, session saved', { shop, scope });
  res.redirect(`${process.env.SHOPIFY_APP_URL}/?shop=${shop}&installed=true`);
});
