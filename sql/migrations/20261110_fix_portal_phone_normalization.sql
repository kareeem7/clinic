-- Normalize international-format phone numbers before matching patient portal credentials.
-- The prior POSIX regex did not strip the leading '+' from E.164 input.
create or replace function public.norm_phone_eg(t text)
returns text language sql immutable as $$
  with d as (select regexp_replace(coalesce(t,''), '[^0-9]', '', 'g') as x)
  select case
    when x like '0020%' then substring(x from 3)
    when x like '0%' and length(x) = 11 then '2' || x
    when x not like '20%' and length(x) = 12 then '20' || x
    when x not like '20%' and length(x) = 10 then '20' || x
    else x end
  from d;
$$;
