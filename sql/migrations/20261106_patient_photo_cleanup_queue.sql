-- Queue Storage objects whenever their clinical record is permanently deleted
-- or its photo is replaced. A privileged worker removes objects from the
-- patient-photos bucket, then acknowledges queue entries. Never delete rows
-- from storage.objects directly; that can leave binary files orphaned.
begin;

alter table public.patient_records add column if not exists photo_path text;

create table if not exists public.patient_photo_cleanup_queue (
  storage_path text primary key,
  queued_at timestamptz not null default now()
);
alter table public.patient_photo_cleanup_queue enable row level security;
revoke all on public.patient_photo_cleanup_queue from public, anon, authenticated;
grant select, delete on public.patient_photo_cleanup_queue to service_role;

create or replace function public.queue_patient_photo_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.photo_path is not null and btrim(old.photo_path) <> ''
     and old.photo_path ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp)$' then
    insert into public.patient_photo_cleanup_queue (storage_path)
      values (old.photo_path) on conflict (storage_path) do nothing;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;
revoke all on function public.queue_patient_photo_cleanup() from public, anon, authenticated;

drop trigger if exists patient_photo_queue_after_record_delete on public.patient_records;
create trigger patient_photo_queue_after_record_delete
  after delete on public.patient_records
  for each row execute function public.queue_patient_photo_cleanup();

drop trigger if exists patient_photo_queue_after_photo_change on public.patient_records;
create trigger patient_photo_queue_after_photo_change
  after update of photo_path on public.patient_records
  for each row when (old.photo_path is distinct from new.photo_path)
  execute function public.queue_patient_photo_cleanup();

commit;
