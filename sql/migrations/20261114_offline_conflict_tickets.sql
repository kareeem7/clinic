-- =====================================================================
-- ترحيل 20261114 — تذاكر تعارضات الأوفلاين (تنبيه الدكتور عبر الأجهزة)
-- ---------------------------------------------------------------------
-- الهدف: لو تسجيل اتعمل أوفلاين على موبايل مريض ورفضه السيرفر وقت الرفع،
-- توصل للدكتور تذكرة مراجعة على **أي جهاز** يفتح منه حسابه، بدل ما التذكرة
-- تفضل على موبايل المريض بس.
--
-- 🚫 التذكرة **بلا أي بيانات مرضى**: وصف العملية + الصنف + السبب + رقم
--    الطلب + نوع الجهاز فقط. ولا كود دخول ولا توكن ولا صور.
--
-- ⚠️ اختياري ومستقل: لا يعتمد على 20261111/12/13، لكن **طبّقه بعدها**
--    (ما تزودش ترحيلات قبل ما الموجودة تتطبّق). لا يُنفَّذ تلقائياً:
--    شغّله يدوياً في Supabase ← SQL Editor. التطبيق بيتجاهل غيابه بأمان
--    ويفضل يستخدم «تذكرة المراجعة» المحلية المنسوخة.
-- =====================================================================

begin;

create table if not exists public.offline_conflict_tickets (
  id               uuid primary key default gen_random_uuid(),
  doctor_id        uuid not null references auth.users(id) on delete cascade,
  patient_id       uuid not null,
  request_id       uuid not null,
  kind             text not null,
  label            text not null,
  reason           text not null,
  origin           text not null default 'patient',
  created_at       timestamptz not null default now(),
  acknowledged_at  timestamptz,
  acknowledged_by  uuid,
  constraint offline_conflict_kind_chk check (kind in (
    'possible-duplicate', 'duplicate', 'daily-limit', 'date-window',
    'foreign-key', 'schema', 'permission', 'validation', 'attachment', 'unknown'
  )),
  constraint offline_conflict_origin_chk check (origin in ('clinic', 'patient')),
  constraint offline_conflict_label_chk check (char_length(label) between 1 and 120),
  constraint offline_conflict_reason_chk check (char_length(reason) between 1 and 400),
  constraint offline_conflict_request_uniq unique (doctor_id, request_id)
);

create index if not exists offline_conflict_open_idx
  on public.offline_conflict_tickets (doctor_id, created_at desc)
  where acknowledged_at is null;

alter table public.offline_conflict_tickets enable row level security;

-- الدكتور يقرأ تذاكره فقط. الكتابة والإقرار عبر دوال security definer فقط،
-- فمفيش عميل يقدر يكتب تذكرة باسم دكتور تاني أو يعدّل/يمسح تذكرة.
drop policy if exists offline_conflict_own_select on public.offline_conflict_tickets;
create policy offline_conflict_own_select on public.offline_conflict_tickets
  for select to authenticated
  using (doctor_id = (select auth.uid()));

revoke all on public.offline_conflict_tickets from public, anon, authenticated;
grant select on public.offline_conflict_tickets to authenticated;

-- ---------------------------------------------------------------------
-- 1) بلاغ من موبايل المريض (anon). التوكن بيتبعت لحظة الرفع فقط،
--    ومش بيتخزّن في التذكرة ولا في الدفتر المحلي.
-- ---------------------------------------------------------------------
create or replace function public.offline_report_conflict(
  p_token uuid, p_request_id uuid, p_kind text,
  p_label text, p_reason text, p_origin text default 'patient'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s record; v_count int;
begin
  if p_token is null or p_request_id is null then
    return jsonb_build_object('ok', false, 'error', 'طلب غير مكتمل');
  end if;

  select * into v_s from public.patient_sessions
   where token = p_token and expires_at > now();
  if not found then
    return jsonb_build_object('ok', false, 'error', 'انتهت جلسة المريض');
  end if;
  if not public.clinic_active(v_s.doctor_id) then
    return jsonb_build_object('ok', false, 'error', 'العيادة غير متاحة حالياً');
  end if;

  -- حد أقصى 20 تذكرة لكل مريض خلال 24 ساعة (حماية من إغراق الجدول)
  select count(*) into v_count from public.offline_conflict_tickets
   where patient_id = v_s.patient_id and created_at > now() - interval '24 hours';
  if v_count >= 20 then
    return jsonb_build_object('ok', false, 'error', 'وصلت للحد اليومي للتذاكر');
  end if;

  insert into public.offline_conflict_tickets
    (doctor_id, patient_id, request_id, kind, label, reason, origin)
  values (
    v_s.doctor_id, v_s.patient_id, p_request_id,
    coalesce(nullif(p_kind, ''), 'unknown'),
    left(coalesce(nullif(p_label, ''), 'تسجيل بيانات'), 120),
    left(coalesce(nullif(p_reason, ''), 'محتاج مراجعة'), 400),
    case when p_origin = 'clinic' then 'clinic' else 'patient' end
  ) on conflict (doctor_id, request_id) do nothing;
  -- on conflict do nothing = إعادة البلاغ بعد رد ضايع ما تكرّرش التذكرة

  insert into public.audit_logs (actor_id, action, entity, meta)
  values (v_s.doctor_id, 'offline-conflict', 'offline_conflict_tickets',
    jsonb_build_object('via', 'portal', 'scope', 'offline-review',
                       'kind', coalesce(nullif(p_kind, ''), 'unknown')));

  return jsonb_build_object('ok', true);
end; $$;

revoke execute on function public.offline_report_conflict(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.offline_report_conflict(uuid, uuid, text, text, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) قائمة التذاكر المفتوحة للدكتور على أي جهاز (محتاج جلسة MFA).
-- ---------------------------------------------------------------------
create or replace function public.offline_list_conflicts(p_limit int default 50)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id,
      'requestId', t.request_id,
      'kind', t.kind,
      'label', t.label,
      'reason', t.reason,
      'origin', t.origin,
      'createdAt', t.created_at
    ) order by t.created_at desc), '[]'::jsonb)
  from (
    select * from public.offline_conflict_tickets
     where doctor_id = (select auth.uid()) and acknowledged_at is null
     order by created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ) t;
$$;

revoke execute on function public.offline_list_conflicts(int) from public, anon, authenticated;
grant execute on function public.offline_list_conflicts(int) to authenticated;

-- ---------------------------------------------------------------------
-- 3) «تمت المراجعة» — إقرار يدوي من الدكتور فقط (مش حل أوتوماتيك).
--    البيانات نفسها لسه على جهاز المريض؛ الإقرار بيقفل التذكرة بس.
-- ---------------------------------------------------------------------
create or replace function public.offline_ack_conflict(p_ticket uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if (select auth.uid()) is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  update public.offline_conflict_tickets
     set acknowledged_at = now(), acknowledged_by = (select auth.uid())
   where id = p_ticket
     and doctor_id = (select auth.uid())
     and acknowledged_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'التذكرة مش موجودة أو اتقفلت قبل كده');
  end if;
  insert into public.audit_logs (actor_id, action, entity, entity_id, meta)
  values ((select auth.uid()), 'offline-conflict-ack', 'offline_conflict_tickets', p_ticket,
          jsonb_build_object('via', 'clinic', 'scope', 'offline-review'));
  return jsonb_build_object('ok', true);
end; $$;

revoke execute on function public.offline_ack_conflict(uuid) from public, anon, authenticated;
grant execute on function public.offline_ack_conflict(uuid) to authenticated;

commit;

-- =====================================================================
-- تحقق يدوي بعد التطبيق:
--   select public.offline_list_conflicts(10);         → [] لو مفيش تذاكر
--   -- من جلسة anon بتوكن بوابة صحيح:
--   select public.offline_report_conflict('<token>', gen_random_uuid(),
--          'daily-limit', 'قياس وزن', 'وصلت للحد اليومي', 'patient');
--   select public.offline_list_conflicts(10);         → تذكرة واحدة بلا PHI
--   select public.offline_ack_conflict('<id>');       → {ok:true}
--   -- محاولة كتابة مباشرة من anon لازم تفشل:
--   insert into public.offline_conflict_tickets(doctor_id, patient_id, request_id,
--     kind, label, reason) values (...);              → permission denied
-- =====================================================================
