-- Keep physician-entered InBody scans in the clinic file only; do not mix
-- their weight/fat values into the existing patient progress portal payload.
-- Safe to re-run; this replaces only the existing read RPC and never changes
-- or deletes patient_records. Apply only after the clinical-record columns exist.
begin;

create or replace function public.patient_portal_records(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s record;
begin
  select * into v_s from public.patient_sessions where token = p_token and expires_at > now();
  if not found then return jsonb_build_object('ok', false, 'error', 'انتهت جلستك — سجّل دخولك من جديد'); end if;
  if not public.clinic_active(v_s.doctor_id) or not exists (
    select 1 from public.patients p
    where p.id = v_s.patient_id and p.doctor_id = v_s.doctor_id and p.deleted_at is null
  ) then
    return jsonb_build_object('ok', false, 'error', 'العيادة أو ملفك غير متاح حالياً — تواصل مع العيادة');
  end if;

  -- Audit ids and scope only; never include health values.
  insert into public.audit_logs (actor_id, action, entity, entity_id, meta)
    values (v_s.doctor_id, 'patient-view', 'patient_records', null, jsonb_build_object('via', 'portal', 'scope', 'progress-page'));

  return (
    select jsonb_build_object('ok', true, 'records', coalesce(jsonb_agg(to_jsonb(r) order by r.date), '[]'::jsonb))
    from (
      select date, weight, waist, hips, fat, session, pain,
             case when source = 'patient' then note else null end as note
      from public.patient_records
      where patient_id = v_s.patient_id and deleted_at is null
        and record_type is distinct from 'inbody'
      order by date asc
    ) r
  );
end; $$;

commit;
