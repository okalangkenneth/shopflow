import { createClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Test connection on startup
export async function testDbConnection(): Promise<void> {
  const { error } = await supabase.from('orders').select('count').limit(1);
  if (error && error.code !== 'PGRST116') {
    logger.error('Database connection failed', { error: error.message });
    throw new Error(`Database connection failed: ${error.message}`);
  }
  logger.info('Database connection established');
}
