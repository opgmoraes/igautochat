-- =========================================================
-- SCHEMA: IG AutoManyChat
-- Rode isso inteiro no SQL Editor do Supabase (um clique)
-- =========================================================

create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------- config (1 linha só) ----------
create table if not exists config (
  id int primary key default 1,
  ig_user_id text,
  ig_username text,
  profile_picture_url text,
  access_token text,
  token_expires_at timestamptz,
  connected_at timestamptz,
  constraint single_row check (id = 1)
);

-- ---------- automations ----------
create table if not exists automations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  trigger_comment boolean not null default true,
  trigger_story_reply boolean not null default false,
  trigger_dm boolean not null default false,
  keywords text[] not null default '{}',
  match_type text not null default 'contains' check (match_type in ('contains','exact','any')),
  target_media_id text,               -- post/reels específico (opcional)
  target_media_thumb text,
  public_replies text[] not null default '{}',  -- variações de resposta pública
  welcome_message text not null default '',
  quick_reply_label text not null default 'Quero!',
  link_label text not null default 'Acessar',
  link_url text not null default '',
  reminder_text text,
  reminder_delay_minutes int default 60,
  created_at timestamptz not null default now()
);

-- ---------- followups (derivados de uma automação) ----------
create table if not exists followups (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid references automations(id) on delete cascade,
  step int not null,               -- 1 = link, 2 = lembrete, etc.
  kind text not null check (kind in ('link','reminder')),
  delay_minutes int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- contacts ----------
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  ig_scoped_id text not null unique,   -- id da pessoa no Instagram
  username text,
  first_contact_at timestamptz not null default now(),
  last_reply_at timestamptz,           -- abre a janela de 24h
  last_automation_id uuid references automations(id),
  created_at timestamptz not null default now()
);

-- ---------- queue (fila de envio, com trava atômica) ----------
create table if not exists queue (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references contacts(id) on delete cascade,
  automation_id uuid references automations(id) on delete set null,
  kind text not null check (kind in ('private_reply','dm','public_reply','link','reminder')),
  payload jsonb not null default '{}',      -- corpo pronto pra API do IG
  recipient_type text not null check (recipient_type in ('comment_id','id')),
  recipient_value text not null,
  needs_24h_window boolean not null default false,
  send_after timestamptz not null default now(),  -- respeita atraso do followup
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','skipped')),
  attempts int not null default 0,
  claimed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists idx_queue_status on queue(status, send_after);

-- ---------- events (log bruto de tudo que chega) ----------
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  kind text not null,          -- comment | message | story_reply
  raw jsonb not null,
  processed boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- RLS ligado, sem policies (só o servidor com service key acessa) ----------
alter table config enable row level security;
alter table automations enable row level security;
alter table followups enable row level security;
alter table contacts enable row level security;
alter table queue enable row level security;
alter table events enable row level security;

-- ---------- linha inicial de config ----------
insert into config (id) values (1) on conflict (id) do nothing;

-- =========================================================
-- CRON JOBS (rodam sozinhos, de graça, dentro do Supabase)
-- Troque SEU_APP_URL e SEU_CRON_SECRET depois de fazer o deploy
-- (existe um passo separado pra isso, não precisa mexer agora)
-- =========================================================
-- select cron.schedule('drain-queue', '* * * * *', $$
--   select net.http_post(
--     url := 'https://SEU_APP_URL/api/cron/drain',
--     headers := jsonb_build_object('x-cron-secret', 'SEU_CRON_SECRET')
--   );
-- $$);
--
-- select cron.schedule('refresh-token', '0 3 * * 1', $$
--   select net.http_post(
--     url := 'https://SEU_APP_URL/api/cron/refresh-token',
--     headers := jsonb_build_object('x-cron-secret', 'SEU_CRON_SECRET')
--   );
-- $$);

-- =========================================================
-- MIGRAÇÃO: corrige exclusão de automação travada
-- Rode isso no SQL Editor do Supabase (uma vez só)
-- =========================================================
-- Permite excluir uma automação mesmo que algum contato já tenha
-- interagido com ela (o contato só perde a referência, não é apagado)
alter table contacts drop constraint if exists contacts_last_automation_id_fkey;
alter table contacts add constraint contacts_last_automation_id_fkey
  foreign key (last_automation_id) references automations(id) on delete set null;

-- =========================================================
-- MIGRAÇÃO: funil de 2 etapas (ex: pedir follow antes do link)
-- Rode isso no SQL Editor do Supabase (uma vez só)
-- =========================================================
alter table automations add column if not exists pre_link_message text;
alter table automations add column if not exists pre_link_quick_reply_label text default 'Já segui!';

-- Libera o novo tipo de item de fila usado na etapa intermediária do funil
alter table queue drop constraint if exists queue_kind_check;
alter table queue add constraint queue_kind_check
  check (kind in ('private_reply','dm','public_reply','link','reminder','prelink'));

-- =========================================================
-- MIGRAÇÃO: modo "meu próximo post" (funciona com posts agendados)
-- Rode isso no SQL Editor do Supabase (uma vez só)
-- =========================================================
alter table automations add column if not exists target_mode text not null default 'any'
  check (target_mode in ('any', 'specific', 'latest'));

-- =========================================================
-- MIGRAÇÃO: fluxo de mensagens com etapas dinâmicas (tipo ManyChat)
-- Rode isso no SQL Editor do Supabase (uma vez só)
-- =========================================================
alter table automations add column if not exists steps jsonb not null default '[]'::jsonb;
alter table queue drop constraint if exists queue_kind_check;
alter table queue add constraint queue_kind_check
  check (kind in ('private_reply','dm','public_reply','link','reminder','prelink','flow_step'));

-- =========================================================
-- MÓDULO: Personal Content OS (Kanban + Calendário de conteúdo)
-- Rode isso no SQL Editor do Supabase (uma vez só)
-- =========================================================
create table if not exists content_pipeline (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content_body text,
  status text not null default 'ideia' check (status in ('ideia', 'organizando', 'pronto')),
  dm_keyword text,
  post_date date,
  source_path text,          -- caminho do arquivo .md de origem (útil pro script Python evitar duplicar)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_content_status on content_pipeline(status);
create index if not exists idx_content_post_date on content_pipeline(post_date);

alter table content_pipeline enable row level security;
-- sem policies: só o servidor com service key acessa (igual as outras tabelas)

-- =========================================================
-- MIGRAÇÃO: múltiplas contas de Instagram conectadas
-- Rode isso no SQL Editor do Supabase (uma vez só)
-- =========================================================

-- Tabela nova: uma linha por conta de Instagram conectada
create table if not exists ig_accounts (
  id uuid primary key default gen_random_uuid(),
  label text,                 -- nome amigável, ex: "Founder" ou "BITTO"
  ig_user_id text unique,
  ig_username text,
  profile_picture_url text,
  access_token text,
  token_expires_at timestamptz,
  connected_at timestamptz,
  created_at timestamptz not null default now()
);
alter table ig_accounts enable row level security;

-- Migra a conta única que já estava conectada (se existir) pra nova tabela
insert into ig_accounts (label, ig_user_id, ig_username, profile_picture_url, access_token, token_expires_at, connected_at)
select coalesce(ig_username, 'Conta principal'), ig_user_id, ig_username, profile_picture_url, access_token, token_expires_at, connected_at
from config
where ig_user_id is not null
on conflict (ig_user_id) do nothing;

-- Cada automação agora pertence a UMA conta específica
alter table automations add column if not exists ig_account_id uuid references ig_accounts(id) on delete cascade;
-- automações antigas (sem conta definida) ficam associadas à primeira conta migrada, se houver
update automations set ig_account_id = (select id from ig_accounts order by created_at limit 1)
where ig_account_id is null;

-- Contatos agora são únicos por CONTA + id do Instagram (a mesma pessoa pode comentar
-- em contas diferentes suas, e são registros separados)
alter table contacts add column if not exists ig_account_id uuid references ig_accounts(id) on delete cascade;
update contacts set ig_account_id = (select id from ig_accounts order by created_at limit 1)
where ig_account_id is null;
alter table contacts drop constraint if exists contacts_ig_scoped_id_key;
alter table contacts drop constraint if exists contacts_account_scoped_unique;
alter table contacts add constraint contacts_account_scoped_unique unique (ig_account_id, ig_scoped_id);

-- Fila de envio também precisa saber de qual conta enviar
alter table queue add column if not exists ig_account_id uuid references ig_accounts(id) on delete cascade;

-- =========================================================
-- MIGRAÇÃO: fluxo com ramificação (múltiplos botões por etapa)
-- e lembrete independente do link final
-- Rode isso no SQL Editor do Supabase (uma vez só)
-- =========================================================
alter table automations add column if not exists reminder_step jsonb;
-- reminder_step guarda: { "text": "...", "link_label": "...", "link_url": "..." }
-- Se link_url estiver vazio, o lembrete vira só uma mensagem de texto, sem botão.

-- OBS: automações criadas antes dessa mudança têm "steps" no formato antigo
-- (por índice numérico, um botão só por etapa). Recomendo recriar do zero as
-- automações de teste que você tiver ativas, pra já usar o formato novo.
