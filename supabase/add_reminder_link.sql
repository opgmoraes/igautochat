-- Permite que o lembrete envie seu próprio link, em vez de sempre reusar
-- o link_label/link_url da etapa final do fluxo.
alter table automations
  add column if not exists reminder_link_label text,
  add column if not exists reminder_link_url text;
