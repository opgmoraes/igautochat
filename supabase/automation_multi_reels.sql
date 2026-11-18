-- Execute uma vez no SQL Editor do mesmo projeto Supabase.
alter table automations add column if not exists target_media_ids text[] not null default '{}';
update automations set target_media_ids = array[target_media_id]
where target_mode = 'specific' and target_media_id is not null and cardinality(target_media_ids) = 0;
