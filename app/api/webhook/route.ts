/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse, after } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { matches, fetchMedia } from '@/lib/instagram';
import { createRun, enqueue } from '@/lib/automation-store';

export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams;
  if (process.env.WEBHOOK_VERIFY_TOKEN && p.get('hub.mode') === 'subscribe' && p.get('hub.verify_token') === process.env.WEBHOOK_VERIFY_TOKEN) return new NextResponse(p.get('hub.challenge'));
  return new NextResponse('Forbidden', {status:403});
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!process.env.IG_APP_SECRET) return new NextResponse('Webhook unavailable', {status:503});
  const signature = req.headers.get('x-hub-signature-256') || '';
  const expected = 'sha256=' + crypto.createHmac('sha256', process.env.IG_APP_SECRET).update(raw).digest('hex');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return new NextResponse('Invalid signature', {status:401});
  let body;
  try { body = JSON.parse(raw); } catch { return new NextResponse('Invalid JSON', {status:400}); }
  const db = supabaseAdmin();
  try {
    for (const entry of body.entry || []) {
      const { data: account, error } = await db.from('accounts').select('*').eq('ig_user_id', entry.id).maybeSingle();
      if (error) throw error;
      if (!account) continue;
      for (const change of entry.changes || []) {
        if (change.field !== 'comments') continue;
        await recordEvent(db,'comment',change.value,`${account.id}:comment:${change.value?.id}`);
        await handleComment(db, account, change.value, entry.time);
      }
      for (const msg of entry.messaging || []) {
        await recordEvent(db,'message',msg,`${account.id}:message:${msg.message?.mid || crypto.createHash('sha256').update(JSON.stringify(msg)).digest('hex')}`);
        await handleMessage(db, account, msg);
      }
    }
  } catch {
    // Não confirma recebimento se a persistência falhar; Meta pode reentregar.
    return NextResponse.json({error:'Não foi possível persistir o evento'}, {status:503});
  }
  after(async () => {
    if (!process.env.CRON_SECRET || !process.env.APP_URL) return;
    try { await fetch(`${process.env.APP_URL}/api/cron/drain`, {method:'POST',headers:{'x-cron-secret':process.env.CRON_SECRET},signal:AbortSignal.timeout(5000)}); } catch { /* cron cobre falhas */ }
  });
  return NextResponse.json({ok:true});
}

type DB = ReturnType<typeof supabaseAdmin>;
async function recordEvent(db: DB, kind: string, raw: unknown, eventKey: string) {
  const {error} = await db.from('events').upsert({kind,raw,event_key:eventKey},{onConflict:'event_key',ignoreDuplicates:true});
  if (error) throw error;
}
async function start(db: DB, account: any, contact: any, auto: any, key: string, commentId?: string, occurredAt?: string) {
  const run = await createRun(db, account.id, contact.id, auto, key);
  await enqueue(db, {
    run_id:run.id, dedup_key:`${run.id}:step:0`, contact_id:contact.id,
    automation_id:run.automation_id, account_id:account.id, kind:'flow_step',
    recipient_type:commentId ? 'comment_id' : 'id', recipient_value:commentId || contact.ig_scoped_id,
    needs_24h_window:!commentId, payload:{step_index:0, occurred_at:occurredAt},
  });
  const {error} = await db.from('contacts').update({last_automation_id:run.automation_id}).eq('id',contact.id);
  if (error) throw error;
  return run;
}

async function handleComment(db: DB, account: any, value: any, entryTime: number) {
  const sender = value.from?.id;
  if (!value.id || !sender || sender === account.ig_user_id || value.media?.media_product_type === 'LIVE') return;
  const legacy = await db.from('queue').select('id').eq('account_id',account.id).eq('recipient_type','comment_id').eq('recipient_value',value.id).is('run_id',null).limit(1).maybeSingle();
  if (legacy.error) throw legacy.error;
  if (legacy.data) return;
  const {data:autos,error} = await db.from('automations').select('*').eq('account_id',account.id).eq('active',true).eq('trigger_comment',true);
  if (error) throw error;
  let latest: string | null = null;
  if ((autos || []).some(a => a.target_mode === 'latest')) {
    try { latest = (await fetchMedia(account.ig_user_id,account.access_token)).data?.[0]?.id || null; } catch { /* falha fechada */ }
  }
  for (const auto of autos || []) {
    if (auto.target_mode === 'specific' && auto.target_media_id !== value.media?.id) continue;
    if (auto.target_mode === 'latest' && (!latest || latest !== value.media?.id)) continue;
    if (!matches(auto.keywords,auto.match_type,value.text || '') || !auto.steps?.length) continue;
    const {data:contact,error} = await db.from('contacts').upsert({account_id:account.id,ig_scoped_id:sender,username:value.from?.username},{onConflict:'account_id,ig_scoped_id'}).select().single();
    if (error) throw error;
    const eventTime = Number(entryTime) * (Number(entryTime) < 1e12 ? 1000 : 1);
    if (!Number.isFinite(eventTime) || eventTime <= 0 || eventTime > Date.now() + 60000) return;
    const run = await start(db,account,contact,auto,`${account.id}:comment:${value.id}`,value.id,new Date(eventTime).toISOString());
    const replies = run.snapshot.public_replies;
    if (replies?.length) await enqueue(db, {
      run_id:run.id,dedup_key:`${run.id}:public`,contact_id:contact.id,automation_id:run.automation_id,account_id:account.id,
      kind:'public_reply',recipient_type:'comment_id',recipient_value:value.id,
      payload:{text:replies[Math.floor(Math.random()*replies.length)]},
    });
    break;
  }
}

async function handleMessage(db: DB, account: any, msg: any) {
  const sender = msg.sender?.id;
  if (!sender || sender === account.ig_user_id || msg.message?.is_echo || !msg.message || msg.message.is_deleted || !msg.message.mid) return;
  const eventTime = Number(msg.timestamp);
  if (!Number.isFinite(eventTime) || eventTime <= 0 || eventTime > Date.now() + 60000) return;
  const {data:contacts,error} = await db.rpc('record_instagram_interaction',{p_account:account.id,p_sender:sender,p_at:new Date(eventTime).toISOString()});
  if (error) throw error;
  const contact = contacts?.[0];
  if (!contact) throw new Error('Contato não persistido');
  const payload = msg.message.quick_reply?.payload;
  if (payload) {
    let run: any;
    let index: number;
    const click = String(payload).match(/^RUN_([0-9a-f-]{36})_(\d+)$/i);
    if (click) {
      index = Number(click[2]);
      const result = await db.from('automation_runs').select('*').eq('id',click[1]).eq('account_id',account.id).eq('contact_id',contact.id).maybeSingle();
      if (result.error) throw result.error;
      run = result.data;
    } else {
      // Botões legados continuam apenas quando há uma etapa anterior enviada.
      const old = String(payload).match(/^STEP_(\d+)$/);
      if (!old || !contact.last_automation_id) return;
      index = Number(old[1]);
      const previous = await db.from('queue').select('id,payload,run_id').eq('account_id',account.id).eq('contact_id',contact.id).eq('automation_id',contact.last_automation_id).eq('kind','flow_step').eq('status','sent').contains('payload',{step_index:index-1}).order('created_at',{ascending:false}).limit(1).maybeSingle();
      if (previous.error) throw previous.error;
      if (!previous.data) return;
      const a = await db.from('automations').select('*').eq('id',contact.last_automation_id).eq('account_id',account.id).single();
      if (a.error) throw a.error;
      if (!a.data) return;
      run = await createRun(db,account.id,contact.id,a.data,`${account.id}:legacy:${previous.data.id}`);
    }
    if (!run || !Number.isInteger(index) || index < 1 || !run.snapshot.steps?.[index]) return;
    const active = await db.from('automations').select('active').eq('id',run.automation_id).eq('account_id',account.id).single();
    if (active.error) throw active.error;
    if (!active.data?.active) return;
    if (click) {
      const prior = await db.from('queue').select('id').eq('run_id',run.id).eq('kind','flow_step').eq('status','sent').contains('payload',{step_index:index-1}).limit(1).maybeSingle();
      if (prior.error) throw prior.error;
      if (!prior.data) return;
    }
    const gated = run.snapshot.require_follow && run.snapshot.steps[index].type === 'link';
    await enqueue(db, {
      run_id:run.id,dedup_key:gated ? `${run.id}:verify:${msg.message.mid}` : `${run.id}:step:${index}`,
      contact_id:contact.id,automation_id:run.automation_id,account_id:account.id,
      kind:gated ? 'verify_follow' : 'flow_step',recipient_type:'id',recipient_value:sender,
      needs_24h_window:true,payload:{step_index:index},
    });
    return;
  }
  const {data:autos,error:autoError} = await db.from('automations').select('*').eq('account_id',account.id).eq('active',true).eq(msg.message.reply_to?.story ? 'trigger_story_reply' : 'trigger_dm',true);
  if (autoError) throw autoError;
  for (const auto of autos || []) {
    if (!auto.steps?.length || !matches(auto.keywords,auto.match_type,msg.message.text || '')) continue;
    await start(db,account,contact,auto,`${account.id}:message:${msg.message.mid}`);
    break;
  }
}
