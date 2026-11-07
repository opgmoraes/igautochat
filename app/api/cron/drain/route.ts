/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendMessage, publicReply, buildLinkMessage, buildQuickReplyMessage, fetchFollowerStatus, MetaSendError } from '@/lib/instagram';
import { followerState, followupsFor, nextFollowup, withinWindow } from '@/lib/automation';
import { enqueue } from '@/lib/automation-store';

export const maxDuration = 60;
type DB = ReturnType<typeof supabaseAdmin>;
class WindowExpired extends Error {}

async function update(db: DB, id: string, values: Record<string, unknown>) {
  const {error} = await db.from('queue').update(values).eq('id',id);
  if (error) throw new Error(error.message);
}

async function continueSequence(db: DB, item: any) {
  if (!item.automation_runs || !item.sent_at) return;
  const run = item.automation_runs;
  const flow = run.snapshot;
  const isLink = item.kind === 'flow_step' && flow.steps[item.payload.step_index]?.type === 'link';
  if (isLink || item.kind === 'sequence') {
    const next = nextFollowup(followupsFor(flow),isLink ? -1 : item.payload.sequence_index,Date.parse(item.sent_at));
    if (next) await enqueue(db, {
      run_id:run.id,dedup_key:`${run.id}:sequence:${next.index}`,account_id:item.account_id,
      contact_id:item.contact_id,automation_id:item.automation_id,kind:'sequence',
      recipient_type:'id',recipient_value:item.contacts.ig_scoped_id,needs_24h_window:true,
      send_after:next.send_after,payload:{sequence_index:next.index},
    });
  }
  await update(db,item.id,{continued_at:new Date().toISOString()});
}

export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) return new NextResponse('Forbidden',{status:403});
  const db = supabaseAdmin();
  const started = Date.now();
  // Um processo encerrado pode já ter enviado à Meta. Não reenviar automaticamente.
  const stale = await db.from('queue').update({status:'failed',error:'Resultado de envio incerto: processo interrompido. Revisar antes de reenviar.'}).eq('status','sending').lt('claimed_at',new Date(Date.now()-10*60000).toISOString());
  if (stale.error) return NextResponse.json({error:'Fila indisponível'}, {status:503});
  const removed = await db.from('queue').update({status:'skipped',error:'Campanha removida'}).eq('status','pending').is('automation_id',null);
  if (removed.error) return NextResponse.json({error:'Fila indisponível'}, {status:503});
  // Recupera uma interrupção ocorrida após envio confirmado, antes do agendamento.
  const repair = await db.from('queue').select('*, contacts(*), automation_runs(*)').eq('status','sent').not('run_id','is',null).is('continued_at',null).limit(50);
  if (repair.error) return NextResponse.json({error:'Fila indisponível'}, {status:503});
  try { for (const item of repair.data || []) await continueSequence(db,item); } catch { return NextResponse.json({error:'Agendamento indisponível'}, {status:503}); }
  const {data:items,error} = await db.from('queue').select('*, accounts(*), automation_runs(*), automations!inner(active)').eq('automations.active',true).eq('status','pending').lte('send_after',new Date().toISOString()).order('send_after').limit(100);
  if (error) return NextResponse.json({error:'Fila indisponível'}, {status:503});
  let sent=0, failed=0, skipped=0;
  for (const item of items || []) {
    if (Date.now()-started > 25000) break;
    const auto = await db.from('automations').select('*').eq('id',item.automation_id).eq('account_id',item.account_id).maybeSingle();
    if (auto.error) return NextResponse.json({error:'Campanhas indisponíveis'}, {status:503});
    if (auto.data && !auto.data.active) continue; // mantém pendente durante a pausa
    const claim = await db.from('queue').update({status:'sending',claimed_at:new Date().toISOString()}).eq('id',item.id).eq('status','pending').select('id').maybeSingle();
    if (claim.error) return NextResponse.json({error:'Claim indisponível'}, {status:503});
    if (!claim.data) continue;
    let accepted = false;
    try {
      if (!auto.data) { await update(db,item.id,{status:'skipped',error:'Campanha removida'}); skipped++; continue; }
      const account = item.accounts;
      if (!account?.access_token || !account?.ig_user_id) throw new Error('Conta desconectada');
      // Busca novamente no momento do envio: cliques reabrem janela, cron não.
      const contactResult = await db.from('contacts').select('*').eq('id',item.contact_id).eq('account_id',item.account_id).single();
      if (contactResult.error) throw new Error('Contato indisponível');
      const contact = contactResult.data;
      if (item.recipient_type === 'id' && !withinWindow(contact.last_reply_at)) {
        await update(db,item.id,{status:'skipped',error:'Fora da janela de 24h; aguardando nova interação não reativa este envio.'}); skipped++; continue;
      }
      const run = item.automation_runs;
      const flow = run?.snapshot || auto.data;
      const callSend = (message: Parameters<typeof sendMessage>[0]['message']) => {
        if (item.recipient_type === 'id' && !withinWindow(contact.last_reply_at)) throw new WindowExpired('Janela de 24h encerrada antes do envio');
        return sendMessage({igUserId:account.ig_user_id,token:account.access_token,recipientType:item.recipient_type,recipientValue:item.recipient_value,message});
      };
      const payload = {...item.payload};
      if (item.kind === 'public_reply') {
        await publicReply(item.recipient_value,account.access_token,payload.text);
      } else if (item.kind === 'verify_follow') {
        const target = flow.steps?.[payload.step_index];
        if (!run || !flow.require_follow || target?.type !== 'link') throw new Error('Verificação sem etapa de link válida');
        const delivered = await db.from('queue').select('id').eq('dedup_key',`${run.id}:step:${payload.step_index}`).maybeSingle();
        if (delivered.error) throw new Error('Não foi possível consultar entrega');
        if (delivered.data) { await update(db,item.id,{status:'skipped',error:'Link já enfileirado'}); skipped++; continue; }
        let profile = null;
        try { profile = await fetchFollowerStatus(contact.ig_scoped_id,account.access_token); } catch { /* indisponível, nunca confirmação */ }
        const state = followerState(profile);
        payload.follower_state = state;
        if (state === 'following') {
          await enqueue(db, {
            run_id:run.id,dedup_key:`${run.id}:step:${payload.step_index}`,contact_id:item.contact_id,
            automation_id:item.automation_id,account_id:item.account_id,kind:'flow_step',recipient_type:'id',
            recipient_value:contact.ig_scoped_id,needs_24h_window:true,payload:{step_index:payload.step_index,follower_verified:true},
          });
        } else {
          await callSend(buildQuickReplyMessage(state === 'not_following' ? 'Ainda não consegui confirmar que você segue este perfil. Siga e tente novamente.' : 'A Meta não permitiu verificar se você segue este perfil agora. O link permanece bloqueado. Você pode tentar novamente.', 'Já segui ✅', `RUN_${run.id}_${payload.step_index}`));
        }
      } else if (item.kind === 'flow_step') {
        const step = flow.steps?.[payload.step_index];
        if (!step) throw new Error('Etapa não existe mais');
        if (item.recipient_type === 'comment_id') {
          const occurred = Date.parse(payload.occurred_at || item.created_at);
          if (!Number.isFinite(occurred) || Date.now()-occurred >= 7*86400000) {
            await update(db,item.id,{status:'skipped',error:'Resposta privada fora do limite de 7 dias'}); skipped++; continue;
          }
        }
        if (step.type === 'link' && flow.require_follow && payload.follower_verified !== true) throw new Error('Link bloqueado: seguidor não verificado');
        const next = flow.steps?.[payload.step_index+1];
        const button = flow.require_follow && next?.type === 'link' ? 'Já segui ✅' : step.button_label;
        const callback = run ? `RUN_${run.id}_${payload.step_index+1}` : `STEP_${payload.step_index+1}`;
        await callSend(step.type === 'link' ? buildLinkMessage({welcome_message:step.text,link_label:step.link_label,link_url:step.link_url,quick_reply_label:''}) : buildQuickReplyMessage(step.text,button,callback));
        payload.delivery_type = step.type;
      } else if (item.kind === 'sequence') {
        const step = followupsFor(flow)[payload.sequence_index];
        if (!step) throw new Error('Follow-up inválido');
        await callSend(buildLinkMessage({welcome_message:step.text,link_label:step.link_label || 'Acessar',link_url:step.link_url || '',quick_reply_label:''}));
        payload.delivery_type = step.link_url ? 'link' : 'message';
      } else {
        await callSend(buildLinkMessage(payload)); // lembretes legados
      }
      accepted = true;
      const sentAt = new Date().toISOString();
      await update(db,item.id,{status:'sent',sent_at:sentAt,error:null,payload});
      sent++;
      // Se falhar aqui, o reparo retoma no próximo cron sem repetir mensagem.
      await continueSequence(db,{...item,payload,sent_at:sentAt,contacts:contact});
    } catch (error) {
      if (accepted) continue;
      if (error instanceof WindowExpired) { await update(db,item.id,{status:'skipped',error:error.message}); skipped++; continue; }
      const attempts = (item.attempts || 0)+1;
      const retry = error instanceof MetaSendError && error.retryable && attempts < 3;
      await update(db,item.id,{
        status:retry ? 'pending' : 'failed',attempts,
        send_after:new Date(Date.now()+Math.pow(2,attempts)*60000).toISOString(),
        error:error instanceof Error ? error.message.slice(0,500) : 'Falha no processamento',
      });
      failed++;
    }
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  return NextResponse.json({ok:true,sent,failed,skipped});
}
