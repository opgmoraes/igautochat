-- Aplicar após schema.sql. Migração aditiva e reexecutável.
begin;
alter table automations add column if not exists require_follow boolean not null default false;
alter table automations add column if not exists followup_steps jsonb not null default '[]'::jsonb;

alter table contacts drop constraint if exists contacts_ig_scoped_id_key;
create unique index if not exists contacts_account_scoped_unique on contacts(account_id, ig_scoped_id);

create table if not exists automation_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  automation_id uuid not null references automations(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  trigger_key text not null unique,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
alter table automation_runs enable row level security;
alter table queue add column if not exists run_id uuid references automation_runs(id) on delete set null;
alter table queue add column if not exists dedup_key text;
alter table queue add column if not exists sent_at timestamptz;
alter table queue add column if not exists continued_at timestamptz;
create unique index if not exists queue_dedup_unique on queue(dedup_key);
create unique index if not exists queue_one_pending_verification
  on queue(run_id, (payload->>'step_index'))
  where kind='verify_follow' and status in ('pending','sending') and run_id is not null;
alter table events add column if not exists event_key text;
create unique index if not exists events_key_unique on events(event_key);
alter table queue drop constraint if exists queue_kind_check;
alter table queue add constraint queue_kind_check check (kind in ('private_reply','dm','public_reply','link','reminder','prelink','flow_step','verify_follow','sequence'));

-- Evita que reentregas atrasadas reduzam a janela ou a estendam até a hora de recebimento.
create or replace function record_instagram_interaction(p_account uuid, p_sender text, p_at timestamptz)
returns setof contacts language sql security invoker set search_path = public as $$
  insert into contacts(account_id, ig_scoped_id, last_reply_at)
  values (p_account, p_sender, least(p_at, now()))
  on conflict (account_id, ig_scoped_id) do update
    set last_reply_at = greatest(contacts.last_reply_at, excluded.last_reply_at)
  returning *;
$$;
revoke all on function record_instagram_interaction(uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function record_instagram_interaction(uuid,text,timestamptz) to service_role;

create or replace function automation_metrics(p_account uuid default null)
returns table(automation_id uuid,messages_sent bigint,links_delivered bigint,verifications bigint,errors bigint)
language sql security invoker set search_path = public as $$
  select q.automation_id,
    count(*) filter (where status='sent' and kind not in ('public_reply','verify_follow')),
    count(*) filter (where status='sent' and payload->>'delivery_type'='link'),
    count(*) filter (where status='sent' and kind='verify_follow'),
    count(*) filter (where status='failed' or (kind='verify_follow' and payload->>'follower_state'='unavailable'))
  from queue q where p_account is null or q.account_id=p_account group by q.automation_id;
$$;
revoke all on function automation_metrics(uuid) from public, anon, authenticated;
grant execute on function automation_metrics(uuid) to service_role;
commit;
