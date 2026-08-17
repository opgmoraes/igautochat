-- CORREÇÃO DO FLUXO DE CAMINHOS / QUICK REPLIES
-- Rode este script UMA VEZ no Supabase > SQL Editor.
-- Ele é seguro para a estrutura atual e não apaga automações.

-- 1) Garante que a fila aceite flow_step.
alter table queue drop constraint if exists queue_kind_check;
alter table queue add constraint queue_kind_check
  check (kind in ('private_reply','dm','public_reply','link','reminder','prelink','flow_step'));

-- 2) Garante que automações tenham steps.
alter table automations add column if not exists steps jsonb not null default '[]'::jsonb;

-- 3) As tentativas antigas que falharam por quick_replies vazio não devem ser
-- tratadas como mensagens enviadas. O código novo também não as usa como trava.
-- Marcamos como skipped apenas para limpar o histórico de tentativas antigas.
update queue
set status = 'skipped',
    error = coalesce(error, 'tentativa antiga de etapa; poderá ser reenviada')
where kind = 'flow_step'
  and status = 'failed';

-- 4) Índice útil para localizar eventos de fluxo rapidamente.
create index if not exists idx_queue_flow_event_mid
  on queue ((payload->>'event_mid'))
  where kind = 'flow_step';
