import type { SupabaseClient } from '@supabase/supabase-js';
import type { Flow } from './automation';

// A unicidade no banco é a autoridade, mesmo com webhooks/cron concorrentes.
export async function enqueue(db: SupabaseClient, row: Record<string, unknown>) {
  const { error } = await db.from('queue').insert(row);
  if (error && error.code !== '23505') throw new Error(`Fila: ${error.message}`);
}

export async function createRun(db: SupabaseClient, accountId: string, contactId: string, auto: Flow & {id:string}, triggerKey: string) {
  const { data, error } = await db.from('automation_runs').upsert({
    account_id: accountId, contact_id: contactId, automation_id: auto.id,
    snapshot: auto, trigger_key: triggerKey,
  }, {onConflict:'trigger_key', ignoreDuplicates:true}).select().maybeSingle();
  if (error) throw new Error(`Execução: ${error.message}`);
  if (data) return data;
  const existing = await db.from('automation_runs').select('*').eq('trigger_key', triggerKey).single();
  if (existing.error) throw new Error(existing.error.message);
  return existing.data;
}
