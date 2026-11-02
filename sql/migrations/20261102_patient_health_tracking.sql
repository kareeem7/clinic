-- Per-patient doctor-controlled tracking switches. These fields are stored on
-- the tenant-owned patient row, so existing patient RLS and composite ownership
-- constraints apply without inferring permissions from diagnosis text.
begin;

alter table public.patients
  add column if not exists glucose_tracking_enabled boolean not null default false,
  add column if not exists blood_pressure_tracking_enabled boolean not null default false;

commit;
