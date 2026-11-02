-- =====================================================================
-- ImmunTrack — database for Supabase (PostgreSQL 15+)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe to re-run: it drops and recreates only objects that start with imt_.
--
-- Security model
--   * The browser never touches tables directly. Every read and write goes
--     through an imt_* function that checks a sign-in token.
--   * Dose records are SEALED: each one is hashed and chained to the one
--     before it, and a trigger blocks any edit or delete unless it comes
--     through a supervisor action that logs a reason.
-- =====================================================================

-- ---------- clean slate (imt_ objects only) ----------
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname like 'imt\_%' loop
    execute 'drop function if exists ' || r.f || ' cascade';
  end loop;
  for r in select tablename from pg_tables where schemaname='public' and tablename like 'imt\_%' loop
    execute 'drop table if exists public.' || quote_ident(r.tablename) || ' cascade';
  end loop;
end $$;
drop sequence if exists imt_child_seq;
drop sequence if exists imt_dose_seq;

-- ---------- reference tables ----------
create table imt_facilities (
  id serial primary key,
  name text not null,
  ward text,
  lat double precision,
  lng double precision
);

create table imt_communities (
  id serial primary key,
  name text not null,
  facility_id int references imt_facilities,
  lat double precision,
  lng double precision
);

create table imt_users (
  id serial primary key,
  username text unique not null,
  pin_hash text not null,
  full_name text not null,
  role text not null check (role in ('vaccinator','supervisor')),
  facility_id int references imt_facilities,
  phone text,
  last_seen timestamptz,
  pending_sync int default 0,
  created_at timestamptz default now()
);

create table imt_tokens (
  token text primary key,
  user_id int references imt_users on delete cascade,
  created_at timestamptz default now()
);

create table imt_vaccines (
  name text primary key,
  doses_per_vial int not null,
  route text,
  default_site text,
  sort int
);

-- Nigeria routine immunisation schedule (NPI), simplified for the demo
create table imt_schedule (
  vaccine text references imt_vaccines,
  dose_no int,
  age_days int not null,
  label text not null,
  max_age_days int,          -- after this age the dose is no longer given (null = no upper limit)
  primary key (vaccine, dose_no)
);

create table imt_batches (
  id serial primary key,
  vaccine text references imt_vaccines,
  batch_no text unique not null,
  expiry date not null,
  doses_received int not null,
  received_at date default current_date
);

create sequence imt_child_seq start 8840;
create sequence imt_dose_seq start 1000;

create table imt_children (
  id serial primary key,
  uid text unique not null,
  client_ref text unique,
  first_name text not null,
  last_name text not null,
  dob date not null,
  sex text,
  lasra_id text,
  birth_cert_no text,
  guardian_name text,
  guardian_phone text,
  community text,
  facility_id int references imt_facilities,
  photo text,
  registered_by int references imt_users,
  lat double precision,
  lng double precision,
  created_at timestamptz default now()
);
create unique index imt_children_lasra on imt_children (upper(lasra_id)) where coalesce(lasra_id,'') <> '';
create unique index imt_children_bc on imt_children (upper(birth_cert_no)) where coalesce(birth_cert_no,'') <> '';

-- An outreach session = one vaccine box collected from the PHC and returned at close of work
create table imt_outreach (
  id serial primary key,
  vaccinator_id int references imt_users,
  facility_id int references imt_facilities,
  community text,
  site_lat double precision,
  site_lng double precision,
  demo_site boolean default false,
  started_at timestamptz default now(),
  closed_at timestamptz,
  status text default 'open',
  recon jsonb,
  recon_flags jsonb default '[]'
);

create table imt_outreach_items (
  id serial primary key,
  outreach_id int references imt_outreach on delete cascade,
  batch_id int references imt_batches,
  vials_issued int not null,
  vials_unused int,
  vials_empty int
);

create table imt_otps (
  id serial primary key,
  child_id int references imt_children on delete cascade,
  user_id int references imt_users,
  dose_id int,
  code text not null,
  created_at timestamptz default now(),
  used boolean default false
);

create table imt_doses (
  id serial primary key,
  uid text unique not null,
  client_ref text unique,
  child_id int references imt_children,
  vaccine text references imt_vaccines,
  dose_no int,
  batch_id int references imt_batches,
  injection_site text,
  vaccinator_id int references imt_users,
  facility_id int references imt_facilities,
  outreach_id int references imt_outreach,
  lat double precision,
  lng double precision,
  gps_accuracy double precision,
  distance_m int,
  captured_at timestamptz not null,
  received_at timestamptz default now(),
  offline boolean default false,
  otp_status text default 'pending',
  photo text,
  flags jsonb default '[]',
  flag_status text default 'none',   -- none | open | accepted | amended | voided
  status text default 'valid',       -- valid | voided
  next_vaccine text,
  next_due date,
  sealed jsonb,
  prev_hash text,
  hash text
);
create index on imt_doses (child_id);
create index on imt_doses (captured_at);

create table imt_audit (
  id serial primary key,
  dose_id int references imt_doses,
  actor_id int references imt_users,
  action text not null,
  reason text,
  before jsonb,
  after jsonb,
  at timestamptz default now()
);

create table imt_activity (
  id serial primary key,
  at timestamptz default now(),
  user_id int references imt_users,
  type text,
  text text
);

-- Simulated SMS outbox (a real deployment would hand these to an SMS gateway)
create table imt_sms (
  id serial primary key,
  at timestamptz default now(),
  to_phone text,
  child_id int references imt_children on delete cascade,
  kind text,
  message text,
  sent_by int references imt_users
);

create table imt_reports (
  id serial primary key,
  name text,
  period text,
  verification numeric,
  status text,
  created_by int references imt_users,
  created_at timestamptz default now()
);

-- Lock every table: no direct access from the browser, only via functions.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname='public' and tablename like 'imt\_%' loop
    execute 'alter table public.' || quote_ident(r.tablename) || ' enable row level security';
    execute 'revoke all on public.' || quote_ident(r.tablename) || ' from anon, authenticated';
  end loop;
end $$;
revoke all on sequence imt_child_seq, imt_dose_seq from anon, authenticated;

-- =====================================================================
-- Seal and guard on dose records
-- =====================================================================
create function imt__seal() returns trigger language plpgsql as $$
declare v_prev text;
begin
  perform pg_advisory_xact_lock(771);
  select hash into v_prev from imt_doses order by id desc limit 1;
  new.prev_hash := coalesce(v_prev, 'GENESIS');
  new.sealed := jsonb_build_object(
    'uid', new.uid, 'child_id', new.child_id, 'vaccine', new.vaccine, 'dose_no', new.dose_no,
    'batch_id', new.batch_id, 'injection_site', new.injection_site, 'vaccinator_id', new.vaccinator_id,
    'lat', new.lat, 'lng', new.lng, 'captured_at', new.captured_at, 'otp_status', new.otp_status,
    'photo_sha256', case when new.photo is null then null else encode(sha256(convert_to(new.photo,'UTF8')),'hex') end);
  new.hash := encode(sha256(convert_to(new.prev_hash || new.sealed::text, 'UTF8')), 'hex');
  return new;
end $$;

create trigger imt_doses_seal before insert on imt_doses for each row execute function imt__seal();

create function imt__guard() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('imt.supervisor_action', true), '') <> 'on' then
    raise exception 'SEALED RECORD: dose records cannot be edited or deleted directly. A supervisor must amend it with a logged reason.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.sealed := old.sealed; new.hash := old.hash; new.prev_hash := old.prev_hash; new.uid := old.uid;
  return new;
end $$;

create trigger imt_doses_guard before update or delete on imt_doses for each row execute function imt__guard();

-- =====================================================================
-- Helpers (internal; not callable from the browser)
-- =====================================================================
create function imt__today() returns date language sql stable as $$
  select (now() at time zone 'Africa/Lagos')::date $$;

create function imt__pin(p text) returns text language sql immutable as $$
  select encode(sha256(convert_to('imt:' || p, 'UTF8')), 'hex') $$;

create function imt__dist(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

create function imt__auth(p_token text, p_role text default null) returns imt_users
language plpgsql security definer set search_path = public as $$
declare u imt_users;
begin
  select u2.* into u from imt_tokens t join imt_users u2 on u2.id = t.user_id
   where t.token = p_token and t.created_at > now() - interval '14 days';
  if not found then raise exception 'Your session has expired. Please sign in again.'; end if;
  if p_role is not null and u.role <> p_role then raise exception 'This action needs a % account.', p_role; end if;
  update imt_users set last_seen = now() where id = u.id;
  return u;
end $$;

create function imt__log(p_user int, p_type text, p_text text) returns void language sql as $$
  insert into imt_activity (user_id, type, text) values (p_user, p_type, p_text) $$;

create function imt__label(p_vaccine text, p_dose int) returns text language sql stable as $$
  select coalesce((select label from imt_schedule where vaccine = p_vaccine and dose_no = p_dose),
                  p_vaccine || ' ' || p_dose) $$;

-- Full schedule status for a child
create function imt__due(p_child int) returns jsonb language plpgsql stable as $$
declare c imt_children; r record; res jsonb := '[]'; v_given timestamptz; v_prev timestamptz;
        v_due date; v_today date := imt__today(); v_status text;
begin
  select * into c from imt_children where id = p_child;
  for r in select s.*, v.sort from imt_schedule s join imt_vaccines v on v.name = s.vaccine
           order by s.age_days, v.sort, s.dose_no loop
    select min(captured_at) into v_given from imt_doses
      where child_id = p_child and vaccine = r.vaccine and dose_no = r.dose_no and status = 'valid';
    select max(captured_at) into v_prev from imt_doses
      where child_id = p_child and vaccine = r.vaccine and dose_no = r.dose_no - 1 and status = 'valid';
    v_due := c.dob + r.age_days;
    if v_prev is not null then v_due := greatest(v_due, (v_prev at time zone 'Africa/Lagos')::date + 28); end if;
    v_status := case when v_given is not null then 'given'
                     when r.max_age_days is not null and v_today > c.dob + r.max_age_days then 'expired'
                     when v_due < v_today then 'overdue'
                     when v_due = v_today then 'due'
                     else 'upcoming' end;
    res := res || jsonb_build_object('vaccine', r.vaccine, 'dose_no', r.dose_no, 'label', r.label,
                                     'due', v_due, 'status', v_status, 'given_at', v_given,
                                     'max_age_days', r.max_age_days,
                                     'last_day', case when r.max_age_days is null then null else c.dob + r.max_age_days end);
  end loop;
  return res;
end $$;

create function imt__next(p_child int) returns jsonb language sql stable as $$
  select e from jsonb_array_elements(imt__due(p_child)) e
   where e->>'status' in ('overdue', 'due', 'upcoming') order by (e->>'due')::date, e->>'vaccine' limit 1 $$;

create function imt__child_json(p_id int, p_photo boolean default true) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', c.id, 'uid', c.uid, 'first_name', c.first_name, 'last_name', c.last_name,
    'name', c.first_name || ' ' || c.last_name, 'dob', c.dob, 'sex', c.sex,
    'lasra_id', c.lasra_id, 'birth_cert_no', c.birth_cert_no,
    'guardian_name', c.guardian_name, 'guardian_phone', c.guardian_phone,
    'community', c.community, 'facility', f.name, 'facility_id', c.facility_id,
    'photo', case when p_photo then c.photo else null end, 'has_photo', c.photo is not null,
    'registered_by', u.full_name, 'created_at', c.created_at)
  from imt_children c left join imt_facilities f on f.id = c.facility_id
       left join imt_users u on u.id = c.registered_by
  where c.id = p_id $$;

create function imt__batch_left(p_batch int) returns int language sql stable as $$
  select b.doses_received
       - (select count(*) from imt_doses d where d.batch_id = b.id and d.status = 'valid')::int
       - coalesce((select sum(greatest(0, (r->>'wasted')::int)) from imt_outreach o,
                    jsonb_array_elements(coalesce(o.recon->'items','[]')) r
                   where (r->>'batch_id')::int = b.id), 0)::int
  from imt_batches b where b.id = p_batch $$;

create function imt__dose_json(p_id int, p_photo boolean default false) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', d.id, 'uid', d.uid, 'child_id', d.child_id, 'child', c.first_name || ' ' || c.last_name,
    'child_uid', c.uid, 'vaccine', d.vaccine, 'dose_no', d.dose_no, 'label', imt__label(d.vaccine, d.dose_no),
    'batch_no', b.batch_no, 'batch_id', d.batch_id, 'injection_site', d.injection_site,
    'vaccinator', u.full_name, 'vaccinator_id', d.vaccinator_id, 'facility', f.name,
    'lat', d.lat, 'lng', d.lng, 'gps_accuracy', d.gps_accuracy, 'distance_m', d.distance_m,
    'captured_at', d.captured_at, 'received_at', d.received_at, 'offline', d.offline,
    'otp_status', d.otp_status, 'flags', d.flags, 'flag_status', d.flag_status, 'status', d.status,
    'next_vaccine', d.next_vaccine, 'next_due', d.next_due, 'hash', d.hash, 'prev_hash', d.prev_hash,
    'has_photo', d.photo is not null, 'photo', case when p_photo then d.photo else null end)
  from imt_doses d join imt_children c on c.id = d.child_id
       left join imt_batches b on b.id = d.batch_id
       left join imt_users u on u.id = d.vaccinator_id
       left join imt_facilities f on f.id = d.facility_id
  where d.id = p_id $$;

create function imt__verified(d imt_doses) returns boolean language sql immutable as $$
  select d.status = 'valid' and d.otp_status = 'verified' and d.flag_status in ('none','accepted','amended') $$;

-- =====================================================================
-- Sign-in
-- =====================================================================
create function imt_login(p_username text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users; v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  select * into u from imt_users where username = lower(trim(p_username)) and pin_hash = imt__pin(p_pin);
  if not found then raise exception 'Wrong username or PIN.'; end if;
  insert into imt_tokens (token, user_id) values (v_token, u.id);
  update imt_users set last_seen = now() where id = u.id;
  perform imt__log(u.id, 'Sign-in', 'Signed in');
  return jsonb_build_object('token', v_token, 'user', jsonb_build_object(
    'id', u.id, 'username', u.username, 'full_name', u.full_name, 'role', u.role,
    'facility', (select name from imt_facilities where id = u.facility_id), 'facility_id', u.facility_id));
end $$;

create function imt_logout(p_token text) returns void
language plpgsql security definer set search_path = public as $$
declare u imt_users;
begin
  select usr.* into u from imt_tokens t join imt_users usr on usr.id = t.user_id where t.token = p_token;
  if found then perform imt__log(u.id, 'Sign-out', 'Signed out'); end if;
  delete from imt_tokens where token = p_token;
end $$;

create function imt_heartbeat(p_token text, p_pending int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token);
begin
  update imt_users set pending_sync = greatest(0, coalesce(p_pending, 0)) where id = u.id;
  return jsonb_build_object('ok', true, 'server_time', now());
end $$;

-- Reference data used by both apps
create function imt_reference(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token);
begin
  return jsonb_build_object(
    'vaccines', (select jsonb_agg(to_jsonb(v) order by v.sort) from imt_vaccines v),
    'schedule', (select jsonb_agg(to_jsonb(s) order by s.age_days, s.vaccine, s.dose_no) from imt_schedule s),
    'facilities', (select jsonb_agg(to_jsonb(f) order by f.name) from imt_facilities f),
    'communities', (select jsonb_agg(jsonb_build_object('name', c.name, 'facility_id', c.facility_id,
                                     'facility', f.name, 'lat', c.lat, 'lng', c.lng) order by c.name)
                    from imt_communities c join imt_facilities f on f.id = c.facility_id),
    'batches', (select jsonb_agg(jsonb_build_object('id', b.id, 'vaccine', b.vaccine, 'batch_no', b.batch_no,
                                 'expiry', b.expiry, 'doses_per_vial', v.doses_per_vial,
                                 'doses_left', imt__batch_left(b.id)) order by v.sort, b.expiry)
                from imt_batches b join imt_vaccines v on v.name = b.vaccine where b.expiry >= imt__today()));
end $$;

-- =====================================================================
-- Vaccinator: children
-- =====================================================================
create function imt_register_child(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token, 'vaccinator'); v_id int; v_dup imt_children; v_fac int;
begin
  if p->>'client_ref' is not null then
    select id into v_id from imt_children where client_ref = p->>'client_ref';
    if found then return imt__child_json(v_id) || jsonb_build_object('due', imt__due(v_id), 'existing', true); end if;
  end if;
  if coalesce(trim(p->>'first_name'), '') = '' or coalesce(trim(p->>'last_name'), '') = '' then
    raise exception 'First and last name are required.'; end if;
  if (p->>'dob') is null then raise exception 'Date of birth is required.'; end if;
  if (p->>'dob')::date > imt__today() then raise exception 'Date of birth cannot be in the future.'; end if;
  if coalesce(trim(p->>'guardian_phone'), '') = '' then raise exception 'Guardian phone is required for OTP confirmation.'; end if;

  select * into v_dup from imt_children
   where (coalesce(p->>'lasra_id','') <> '' and upper(lasra_id) = upper(trim(p->>'lasra_id')))
      or (coalesce(p->>'birth_cert_no','') <> '' and upper(birth_cert_no) = upper(trim(p->>'birth_cert_no')))
   limit 1;
  if found then
    raise exception 'DUPLICATE: This child is already registered as % (%). Search for the existing ID instead.',
      v_dup.uid, v_dup.first_name || ' ' || v_dup.last_name;
  end if;

  v_fac := coalesce((select facility_id from imt_communities where name = p->>'community' limit 1), u.facility_id);
  insert into imt_children (uid, client_ref, first_name, last_name, dob, sex, lasra_id, birth_cert_no,
                            guardian_name, guardian_phone, community, facility_id, photo, registered_by, lat, lng, created_at)
  values ('IMT-LAG-AL-' || lpad(nextval('imt_child_seq')::text, 5, '0'), p->>'client_ref',
          initcap(trim(p->>'first_name')), initcap(trim(p->>'last_name')), (p->>'dob')::date, p->>'sex',
          nullif(upper(trim(p->>'lasra_id')), ''), nullif(upper(trim(p->>'birth_cert_no')), ''),
          trim(p->>'guardian_name'), regexp_replace(p->>'guardian_phone', '[^0-9+]', '', 'g'),
          p->>'community', v_fac, p->>'photo', u.id,
          (p->>'lat')::double precision, (p->>'lng')::double precision,
          coalesce((p->>'captured_at')::timestamptz, now()))
  returning id into v_id;
  perform imt__log(u.id, 'Registration', 'Registered child · ' || initcap(trim(p->>'first_name')) || ' ' || initcap(trim(p->>'last_name'))
                   || case when coalesce(p->>'lasra_id','') = '' then ' · no LASRA ID' else '' end);
  return imt__child_json(v_id) || jsonb_build_object('due', imt__due(v_id), 'existing', false);
end $$;

create function imt_find_children(p_token text, p_q text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token); v_q text := '%' || lower(trim(coalesce(p_q, ''))) || '%';
begin
  return coalesce((select jsonb_agg(imt__child_json(c.id, true) || jsonb_build_object('next', imt__next(c.id)))
    from (select id from imt_children
          where trim(coalesce(p_q,'')) = ''
             or lower(uid) like v_q or lower(coalesce(lasra_id,'')) like v_q
             or lower(coalesce(birth_cert_no,'')) like v_q or lower(first_name || ' ' || last_name) like v_q
             or lower(last_name || ' ' || first_name) like v_q or coalesce(guardian_phone,'') like v_q
             or lower(coalesce(guardian_name,'')) like v_q
          order by created_at desc limit 25) c), '[]');
end $$;

create function imt_child_card(p_token text, p_child int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token);
begin
  if not exists (select 1 from imt_children where id = p_child) then raise exception 'Child not found.'; end if;
  return imt__child_json(p_child) || jsonb_build_object(
    'due', imt__due(p_child), 'next', imt__next(p_child),
    'doses', coalesce((select jsonb_agg(imt__dose_json(d.id) order by d.captured_at desc)
                       from imt_doses d where d.child_id = p_child), '[]'));
end $$;

-- =====================================================================
-- Vaccinator: outreach session (vaccine box)
-- =====================================================================
create function imt_start_outreach(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token, 'vaccinator'); v_id int; c imt_communities; it jsonb; v_lat double precision; v_lng double precision; v_n int := 0;
begin
  if exists (select 1 from imt_outreach where vaccinator_id = u.id and status = 'open') then
    raise exception 'You already have an open outreach session. Close it first.'; end if;
  select * into c from imt_communities where name = p->>'community' limit 1;
  if not found then raise exception 'Choose the planned community.'; end if;
  v_lat := c.lat; v_lng := c.lng;
  if coalesce((p->>'demo_site')::boolean, false) and (p->>'lat') is not null then
    v_lat := (p->>'lat')::double precision; v_lng := (p->>'lng')::double precision;
  end if;
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 then raise exception 'Add at least one vaccine batch to the box.'; end if;
  insert into imt_outreach (vaccinator_id, facility_id, community, site_lat, site_lng, demo_site)
  values (u.id, c.facility_id, c.name, v_lat, v_lng, coalesce((p->>'demo_site')::boolean, false)) returning id into v_id;
  for it in select * from jsonb_array_elements(p->'items') loop
    if coalesce((it->>'vials')::int, 0) > 0 then
      insert into imt_outreach_items (outreach_id, batch_id, vials_issued) values (v_id, (it->>'batch_id')::int, (it->>'vials')::int);
      v_n := v_n + 1;
    end if;
  end loop;
  if v_n = 0 then raise exception 'Enter how many vials of each batch you collected.'; end if;
  perform imt__log(u.id, 'Outreach', 'Collected vaccine box · ' || v_n || ' batch(es) · planned site ' || c.name
                   || case when coalesce((p->>'demo_site')::boolean, false) then ' (demo: site set to current location)' else '' end);
  return jsonb_build_object('id', v_id);
end $$;

create function imt__outreach_json(p_id int) returns jsonb language sql stable as $$
  select jsonb_build_object('id', o.id, 'community', o.community, 'site_lat', o.site_lat, 'site_lng', o.site_lng,
    'demo_site', o.demo_site, 'started_at', o.started_at, 'closed_at', o.closed_at, 'status', o.status,
    'recon', o.recon, 'recon_flags', o.recon_flags, 'vaccinator', u.full_name, 'facility', f.name,
    'items', coalesce((select jsonb_agg(jsonb_build_object('batch_id', i.batch_id, 'batch_no', b.batch_no, 'vaccine', b.vaccine,
               'doses_per_vial', v.doses_per_vial, 'vials_issued', i.vials_issued, 'vials_unused', i.vials_unused,
               'vials_empty', i.vials_empty,
               'doses_recorded', (select count(*) from imt_doses d where d.outreach_id = o.id and d.batch_id = i.batch_id and d.status = 'valid'))
               order by v.sort) from imt_outreach_items i join imt_batches b on b.id = i.batch_id
               join imt_vaccines v on v.name = b.vaccine where i.outreach_id = o.id), '[]'),
    'doses', (select count(*) from imt_doses d where d.outreach_id = o.id and d.status = 'valid'))
  from imt_outreach o join imt_users u on u.id = o.vaccinator_id left join imt_facilities f on f.id = o.facility_id
  where o.id = p_id $$;

create function imt_close_outreach(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token, 'vaccinator'); o imt_outreach; i record; it jsonb;
        v_unused int; v_empty int; v_rec int; v_cap int; v_items jsonb := '[]'; v_flags jsonb := '[]'; v_waste numeric;
begin
  select * into o from imt_outreach where vaccinator_id = u.id and status = 'open' order by id desc limit 1;
  if not found then raise exception 'No open outreach session.'; end if;
  for i in select oi.*, b.batch_no, b.vaccine, v.doses_per_vial from imt_outreach_items oi
           join imt_batches b on b.id = oi.batch_id join imt_vaccines v on v.name = b.vaccine where oi.outreach_id = o.id loop
    select e into it from jsonb_array_elements(coalesce(p->'items','[]')) e where (e->>'batch_id')::int = i.batch_id;
    v_unused := coalesce((it->>'unused')::int, 0);
    v_empty := coalesce((it->>'empty')::int, 0);
    if v_unused < 0 or v_empty < 0 then raise exception 'Vial counts cannot be negative.'; end if;
    update imt_outreach_items set vials_unused = v_unused, vials_empty = v_empty where id = i.id;
    select count(*) into v_rec from imt_doses where outreach_id = o.id and batch_id = i.batch_id and status = 'valid';
    v_cap := v_empty * i.doses_per_vial;
    v_waste := case when v_cap > 0 then round(100.0 * (v_cap - v_rec) / v_cap) else 0 end;
    v_items := v_items || jsonb_build_object('batch_id', i.batch_id, 'batch_no', i.batch_no, 'vaccine', i.vaccine,
                 'issued', i.vials_issued, 'unused', v_unused, 'empty', v_empty, 'capacity', v_cap,
                 'recorded', v_rec, 'wasted', greatest(0, v_cap - v_rec), 'wastage_pct', v_waste);
    if i.vials_issued <> v_unused + v_empty then
      v_flags := v_flags || jsonb_build_object('code', 'VIALS_UNACCOUNTED', 'batch_no', i.batch_no,
        'text', format('%s %s: %s vial(s) issued but %s returned (%s unused + %s empty)', i.vaccine, i.batch_no,
                       i.vials_issued, v_unused + v_empty, v_unused, v_empty));
    end if;
    if v_rec > v_cap then
      v_flags := v_flags || jsonb_build_object('code', 'DOSES_EXCEED_VIALS', 'batch_no', i.batch_no,
        'text', format('%s %s: %s doses recorded but opened vials hold only %s', i.vaccine, i.batch_no, v_rec, v_cap));
    elsif v_empty > 0 and v_rec = 0 then
      v_flags := v_flags || jsonb_build_object('code', 'EMPTY_NO_DOSES', 'batch_no', i.batch_no,
        'text', format('%s %s: %s empty vial(s) returned with no doses recorded — possible vial dumping', i.vaccine, i.batch_no, v_empty));
    elsif v_cap > 0 and v_waste > 50 and (v_cap - v_rec) > i.doses_per_vial then
      v_flags := v_flags || jsonb_build_object('code', 'HIGH_WASTAGE', 'batch_no', i.batch_no,
        'text', format('%s %s: %s%% wastage (%s of %s doses unaccounted) — possible vial dumping', i.vaccine, i.batch_no, v_waste, v_cap - v_rec, v_cap));
    end if;
  end loop;
  update imt_outreach set status = 'closed', closed_at = now(), recon = jsonb_build_object('items', v_items), recon_flags = v_flags
   where id = o.id;
  perform imt__log(u.id, 'Outreach', 'Returned vaccine box · ' || o.community
                   || case when jsonb_array_length(v_flags) > 0 then ' · ' || jsonb_array_length(v_flags) || ' stock flag(s)' else ' · reconciled' end);
  return imt__outreach_json(o.id);
end $$;

-- =====================================================================
-- Vaccinator: OTP and dose recording
-- =====================================================================
create function imt_request_otp(p_token text, p_child int, p_vaccine text default null, p_dose_id int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token, 'vaccinator'); c imt_children; v_code text := lpad((floor(random() * 9000) + 1000)::int::text, 4, '0'); v_msg text;
begin
  select * into c from imt_children where id = p_child;
  if not found then raise exception 'Child not found.'; end if;
  insert into imt_otps (child_id, user_id, dose_id, code) values (c.id, u.id, p_dose_id, v_code);
  v_msg := format('ImmunTrack: %s is receiving %s from %s. Give this code to the health worker ONLY if the vaccine is given to your child in front of you. Valid for this visit: %s',
                  c.first_name, coalesce(p_vaccine, 'a vaccine'), u.full_name, v_code);
  insert into imt_sms (to_phone, child_id, kind, message, sent_by) values (c.guardian_phone, c.id, 'otp', v_msg, u.id);
  return jsonb_build_object('code', v_code, 'phone', c.guardian_phone, 'message', v_msg);
end $$;

create function imt_record_dose(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token, 'vaccinator'); c imt_children; b imt_batches; o imt_outreach; s imt_schedule;
        v_id int; v_existing int; v_otp imt_otps; v_otp_status text := 'pending'; v_flags jsonb := '[]';
        v_lat double precision := (p->>'lat')::double precision; v_lng double precision := (p->>'lng')::double precision;
        v_at timestamptz := coalesce((p->>'captured_at')::timestamptz, now()); v_dist double precision;
        v_ref_lat double precision; v_ref_lng double precision; v_ref_name text; v_prev imt_doses; v_last timestamptz;
        v_dup imt_doses; v_n int; v_next jsonb; v_vaccine text := p->>'vaccine'; v_dose int := (p->>'dose_no')::int;
        v_offline boolean := coalesce((p->>'offline')::boolean, false); v_min int; v_sms text;
begin
  if p->>'client_ref' is not null then
    select id into v_existing from imt_doses where client_ref = p->>'client_ref';
    if found then return imt__dose_json(v_existing) || jsonb_build_object('existing', true); end if;
  end if;
  if (p->>'child_id') is not null then select * into c from imt_children where id = (p->>'child_id')::int;
  else select * into c from imt_children where client_ref = p->>'child_ref'; end if;
  if c.id is null then raise exception 'Child not found. Register the child first.'; end if;
  if v_vaccine is null or v_dose is null then raise exception 'Choose the vaccine and dose number.'; end if;
  select * into s from imt_schedule where vaccine = v_vaccine and dose_no = v_dose;
  if not found then raise exception '% dose % is not on the schedule.', v_vaccine, v_dose; end if;
  select * into b from imt_batches where id = (p->>'batch_id')::int;
  if not found then raise exception 'Choose the batch / lot number.'; end if;
  if coalesce(p->>'injection_site', '') = '' then raise exception 'Choose the site of administration.'; end if;

  -- guardian OTP
  if coalesce(p->>'otp', '') <> '' then
    -- one guardian code covers every vaccine given to THIS child in the same visit (30 minutes)
    select * into v_otp from imt_otps where child_id = c.id and user_id = u.id
       and created_at > now() - interval '30 minutes' and code = p->>'otp' order by id desc limit 1;
    if v_otp.id is null then
      if v_offline then v_otp_status := 'pending';
      else raise exception 'That code is wrong or has expired. Ask the guardian for the latest SMS code, or send a new one.'; end if;
    else
      update imt_otps set used = true where id = v_otp.id;
      v_otp_status := 'verified';
    end if;
  end if;

  -- outreach session / reference point for GPS
  select * into o from imt_outreach where vaccinator_id = u.id and status = 'open' order by id desc limit 1;
  if o.id is not null then v_ref_lat := o.site_lat; v_ref_lng := o.site_lng; v_ref_name := 'planned site ' || o.community;
  else select lat, lng, name into v_ref_lat, v_ref_lng, v_ref_name from imt_facilities where id = u.facility_id;
       v_ref_name := 'facility ' || v_ref_name; end if;

  -- ---------- verification rules ----------
  if v_lat is null then
    v_flags := v_flags || jsonb_build_object('code', 'NO_GPS', 'text', 'No GPS location captured');
  else
    v_dist := imt__dist(v_lat, v_lng, v_ref_lat, v_ref_lng);
    if v_dist > 1000 then
      v_flags := v_flags || jsonb_build_object('code', 'GPS_MISMATCH',
        'text', format('GPS mismatch: recorded %s km from %s', round((v_dist / 1000)::numeric, 1), v_ref_name));
    end if;
  end if;
  if v_otp_status <> 'verified' then
    v_flags := v_flags || jsonb_build_object('code', 'OTP_PENDING', 'text', 'No guardian OTP confirmation'
      || case when v_offline then ' (captured offline)' else '' end);
  end if;
  if coalesce(p->>'photo', '') = '' then
    v_flags := v_flags || jsonb_build_object('code', 'NO_FACE', 'text', 'No face photo captured at point of care');
  end if;
  if b.vaccine <> v_vaccine then
    v_flags := v_flags || jsonb_build_object('code', 'BATCH_MISMATCH', 'text', format('Batch %s is %s, not %s', b.batch_no, b.vaccine, v_vaccine));
  end if;
  if b.expiry < (v_at at time zone 'Africa/Lagos')::date then
    v_flags := v_flags || jsonb_build_object('code', 'BATCH_EXPIRED', 'text', format('Batch %s expired on %s', b.batch_no, b.expiry));
  end if;
  if o.id is not null and not exists (select 1 from imt_outreach_items where outreach_id = o.id and batch_id = b.id) then
    v_flags := v_flags || jsonb_build_object('code', 'BATCH_NOT_ISSUED', 'text', format('Batch %s was not in the vaccine box collected for this session', b.batch_no));
  end if;
  if imt__batch_left(b.id) <= 0 then
    v_flags := v_flags || jsonb_build_object('code', 'STOCK_EXHAUSTED', 'text', format('Batch %s has no doses left on record', b.batch_no));
  end if;
  select * into v_dup from imt_doses where child_id = c.id and vaccine = v_vaccine and dose_no = v_dose and status = 'valid' limit 1;
  if v_dup.id is not null then
    v_flags := v_flags || jsonb_build_object('code', 'DUPLICATE_DOSE', 'text',
      format('Duplicate: %s was already recorded on %s', s.label, to_char(v_dup.captured_at at time zone 'Africa/Lagos', 'DD Mon YYYY')));
  end if;
  select min(dose_no) into v_min from imt_schedule where vaccine = v_vaccine;
  if v_dose > v_min then
    select * into v_prev from imt_doses where child_id = c.id and vaccine = v_vaccine and dose_no = v_dose - 1 and status = 'valid'
      order by captured_at desc limit 1;
    if v_prev.id is null and not exists (
         -- a missed dose whose age window has closed (e.g. OPV 0 after 2 weeks) does not block the next one
         select 1 from imt_schedule ps where ps.vaccine = v_vaccine and ps.dose_no = v_dose - 1
           and ps.max_age_days is not null and (v_at at time zone 'Africa/Lagos')::date > c.dob + ps.max_age_days) then
      v_flags := v_flags || jsonb_build_object('code', 'SEQUENCE', 'text', format('Previous dose (%s) is not on record', imt__label(v_vaccine, v_dose - 1)));
    elsif v_at - v_prev.captured_at < interval '28 days' then
      v_flags := v_flags || jsonb_build_object('code', 'TOO_SOON', 'text',
        format('Only %s day(s) after %s — minimum interval is 28 days', extract(day from v_at - v_prev.captured_at)::int, imt__label(v_vaccine, v_dose - 1)));
    end if;
  end if;
  if (v_at at time zone 'Africa/Lagos')::date < c.dob + s.age_days - 7 then
    v_flags := v_flags || jsonb_build_object('code', 'TOO_YOUNG', 'text',
      format('Child is younger than the minimum age for %s (%s weeks)', s.label, s.age_days / 7));
  end if;
  if s.max_age_days is not null and (v_at at time zone 'Africa/Lagos')::date > c.dob + s.max_age_days then
    v_flags := v_flags || jsonb_build_object('code', 'TOO_OLD', 'text',
      format('Child is past the upper age limit for %s (%s) — this dose should not be given',
             s.label, case when s.max_age_days < 60 then (s.max_age_days / 7) || ' weeks'
                           when s.max_age_days < 700 then round(s.max_age_days / 30.4) || ' months'
                           else round(s.max_age_days / 365.25) || ' years' end));
  end if;
  -- several vaccines for the SAME child in one visit is normal; only a quick switch to a DIFFERENT child is suspicious
  select max(captured_at) into v_last from imt_doses where vaccinator_id = u.id and status = 'valid' and child_id <> c.id;
  if v_last is not null and abs(extract(epoch from v_at - v_last)) < 45 then
    v_flags := v_flags || jsonb_build_object('code', 'RAPID_ENTRY', 'text',
      format('Entered %s seconds after a dose for a different child — too fast for a real vaccination', abs(extract(epoch from v_at - v_last))::int));
  end if;
  select count(*) into v_n from imt_children where guardian_phone = c.guardian_phone and coalesce(c.guardian_phone, '') <> '';
  if v_n >= 4 then
    v_flags := v_flags || jsonb_build_object('code', 'SHARED_PHONE', 'text', format('Guardian phone is linked to %s children — possible ghost children', v_n));
  end if;

  insert into imt_doses (uid, client_ref, child_id, vaccine, dose_no, batch_id, injection_site, vaccinator_id, facility_id,
                         outreach_id, lat, lng, gps_accuracy, distance_m, captured_at, offline, otp_status, photo, flags, flag_status)
  values ('DOSE-' || to_char(now() at time zone 'Africa/Lagos', 'YYMMDD') || '-' || nextval('imt_dose_seq'), p->>'client_ref',
          c.id, v_vaccine, v_dose, b.id, p->>'injection_site', u.id, coalesce(o.facility_id, u.facility_id), o.id,
          v_lat, v_lng, (p->>'accuracy')::double precision, v_dist::int, v_at, v_offline, v_otp_status, nullif(p->>'photo', ''),
          v_flags, case when jsonb_array_length(v_flags) > 0 then 'open' else 'none' end)
  returning id into v_id;
  if v_otp.id is not null and v_otp_status = 'verified' then update imt_otps set dose_id = coalesce(dose_id, v_id) where id = v_otp.id; end if;

  v_next := imt__next(c.id);
  if v_next is not null then
    perform set_config('imt.supervisor_action', 'on', true);
    update imt_doses set next_vaccine = v_next->>'label', next_due = (v_next->>'due')::date where id = v_id;
    perform set_config('imt.supervisor_action', 'off', true);
    v_sms := case when (v_next->>'due')::date <= imt__today() then
               format('ImmunTrack: thank you. %s is still due for %s — please ask at your next visit. Show ID %s at any Lagos State health facility.',
                      c.first_name, v_next->>'label', c.uid)
             else
               format('ImmunTrack reminder: %s is due for %s on %s. Bring the child (or the ID %s) to any Lagos State health facility. We will remind you 2 days before.',
                      c.first_name, v_next->>'label', to_char((v_next->>'due')::date, 'DD Mon YYYY'), c.uid) end;
    insert into imt_sms (to_phone, child_id, kind, message, sent_by) values (c.guardian_phone, c.id, 'reminder-scheduled', v_sms, u.id);
  end if;
  perform imt__log(u.id, 'Dose', 'Recorded ' || s.label || ' · ' || c.first_name || ' ' || c.last_name
                   || case when v_offline then ' · synced from offline' else '' end
                   || case when jsonb_array_length(v_flags) > 0 then ' · flagged' else ' · verified' end);
  return imt__dose_json(v_id) || jsonb_build_object('existing', false, 'reminder_sms', v_sms, 'next', v_next);
end $$;

-- Confirm a dose that was captured without OTP (e.g. offline)
create function imt_confirm_dose_otp(p_token text, p_dose int, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token, 'vaccinator'); d imt_doses; v_otp imt_otps; v_flags jsonb;
begin
  select * into d from imt_doses where id = p_dose;
  if not found or d.vaccinator_id <> u.id then raise exception 'Dose not found.'; end if;
  if d.otp_status = 'verified' then return imt__dose_json(d.id); end if;
  select * into v_otp from imt_otps where child_id = d.child_id and user_id = u.id and not used
     and created_at > now() - interval '30 minutes' order by id desc limit 1;
  if v_otp.id is null or v_otp.code <> p_code then raise exception 'That code is wrong or has expired.'; end if;
  update imt_otps set used = true, dose_id = d.id where id = v_otp.id;
  select coalesce(jsonb_agg(e), '[]') into v_flags from jsonb_array_elements(d.flags) e where e->>'code' <> 'OTP_PENDING';
  perform set_config('imt.supervisor_action', 'on', true);
  update imt_doses set otp_status = 'verified', flags = v_flags,
         flag_status = case when jsonb_array_length(v_flags) = 0 and flag_status = 'open' then 'none' else flag_status end
   where id = d.id;
  perform set_config('imt.supervisor_action', 'off', true);
  insert into imt_audit (dose_id, actor_id, action, reason) values (d.id, u.id, 'otp-confirmed', 'Guardian confirmed by SMS code after capture');
  perform imt__log(u.id, 'Dose', 'Guardian OTP confirmed late · ' || d.uid);
  return imt__dose_json(d.id);
end $$;

create function imt_vaccinator_home(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token, 'vaccinator'); v_o int; v_today date := imt__today();
begin
  select id into v_o from imt_outreach where vaccinator_id = u.id and status = 'open' order by id desc limit 1;
  return jsonb_build_object(
    'outreach', case when v_o is null then null else imt__outreach_json(v_o) end,
    'last_closed', (select imt__outreach_json(id) from imt_outreach where vaccinator_id = u.id and status = 'closed' order by closed_at desc limit 1),
    'doses_today', (select count(*) from imt_doses where vaccinator_id = u.id and (captured_at at time zone 'Africa/Lagos')::date = v_today),
    'doses_flagged_today', (select count(*) from imt_doses where vaccinator_id = u.id and flag_status = 'open' and (captured_at at time zone 'Africa/Lagos')::date = v_today),
    'children_today', (select count(*) from imt_children where registered_by = u.id and (created_at at time zone 'Africa/Lagos')::date = v_today),
    'doses_total', (select count(*) from imt_doses where vaccinator_id = u.id and status = 'valid'),
    'verified_total', (select count(*) from imt_doses d where vaccinator_id = u.id and imt__verified(d)),
    'recent', coalesce((select jsonb_agg(imt__dose_json(id) order by captured_at desc) from
                 (select id, captured_at from imt_doses where vaccinator_id = u.id order by captured_at desc limit 20) x), '[]'),
    'activity', coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'type', a.type, 'text', a.text, 'who', u.full_name) order by a.at desc)
                 from (select * from imt_activity where user_id = u.id order by at desc limit 25) a), '[]'));
end $$;

-- =====================================================================
-- Supervisor
-- =====================================================================
create function imt_sup_overview(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token, 'supervisor'); v_today date := imt__today(); v_week date := imt__today() - 6;
        v_total int; v_ver int; v_alerts jsonb := '[]'; r record;
begin
  select count(*) filter (where d.status = 'valid'), count(*) filter (where imt__verified(d))
    into v_total, v_ver from imt_doses d where (d.captured_at at time zone 'Africa/Lagos')::date >= v_week;

  for r in select full_name, pending_sync from imt_users
           where role = 'vaccinator' and pending_sync > 0 and (last_seen is null or last_seen < now() - interval '10 minutes') loop
    v_alerts := v_alerts || jsonb_build_object('level', 'Urgent', 'text', format('%s offline with %s unsynced record(s)', r.full_name, r.pending_sync));
  end loop;
  for r in select o.community, u2.full_name, f.value->>'text' as t from imt_outreach o join imt_users u2 on u2.id = o.vaccinator_id,
           jsonb_array_elements(o.recon_flags) f where o.closed_at > now() - interval '7 days' order by o.closed_at desc limit 5 loop
    v_alerts := v_alerts || jsonb_build_object('level', 'Urgent', 'text', format('Stock: %s (%s, %s)', r.t, r.full_name, r.community));
  end loop;
  for r in select u2.full_name, count(*) n, count(*) filter (where imt__verified(d)) v
           from imt_doses d join imt_users u2 on u2.id = d.vaccinator_id
           where (d.captured_at at time zone 'Africa/Lagos')::date >= v_week and d.status = 'valid'
           group by u2.full_name having count(*) >= 5 and count(*) filter (where imt__verified(d)) * 100 / count(*) < 80 loop
    v_alerts := v_alerts || jsonb_build_object('level', 'Watch', 'text', format('%s: verification rate %s%% (below 80%%)', r.full_name, r.v * 100 / r.n));
  end loop;
  for r in select b.vaccine, b.batch_no, imt__batch_left(b.id) l, b.expiry from imt_batches b order by b.vaccine loop
    if r.l < 40 then v_alerts := v_alerts || jsonb_build_object('level', 'Watch', 'text', format('%s stock low: %s doses left (%s)', r.vaccine, r.l, r.batch_no));
    elsif r.expiry < v_today + 60 then v_alerts := v_alerts || jsonb_build_object('level', 'Watch', 'text', format('%s batch %s expires %s', r.vaccine, r.batch_no, to_char(r.expiry, 'DD Mon YYYY')));
    end if;
  end loop;
  if (select count(*) from imt_children where coalesce(lasra_id, '') = '') > 0 then
    v_alerts := v_alerts || jsonb_build_object('level', 'Watch', 'text',
      format('%s registered child(ren) without LASRA ID', (select count(*) from imt_children where coalesce(lasra_id, '') = '')));
  end if;

  return jsonb_build_object(
    'supervisor', u.full_name,
    'verification_rate', case when v_total = 0 then null else round(100.0 * v_ver / v_total) end,
    'doses_week', v_total,
    'doses_today', (select count(*) from imt_doses where status = 'valid' and (captured_at at time zone 'Africa/Lagos')::date = v_today),
    'online', (select count(*) from imt_users where role = 'vaccinator' and last_seen > now() - interval '10 minutes'),
    'vaccinators', (select count(*) from imt_users where role = 'vaccinator'),
    'open_flags', (select count(*) from imt_doses where flag_status = 'open'),
    'lasra_coverage', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where coalesce(lasra_id, '') <> '') / count(*)) end from imt_children),
    'children', (select count(*) from imt_children),
    'unsynced', (select coalesce(sum(pending_sync), 0) from imt_users),
    'chart', (select jsonb_agg(jsonb_build_object('day', d::date, 'reported',
                 (select count(*) from imt_doses x where x.status = 'valid' and (x.captured_at at time zone 'Africa/Lagos')::date = d::date),
                 'verified', (select count(*) from imt_doses x where imt__verified(x) and (x.captured_at at time zone 'Africa/Lagos')::date = d::date))
                 order by d) from generate_series(v_week, v_today, interval '1 day') d),
    'alerts', v_alerts,
    'activity', coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'who', u2.full_name, 'type', a.type, 'text', a.text) order by a.at desc)
                 from (select * from imt_activity order by at desc limit 8) a join imt_users u2 on u2.id = a.user_id), '[]'),
    'facilities', coalesce((select jsonb_agg(x order by (x->>'rate')::numeric desc nulls last) from (
                 select jsonb_build_object('name', f.name, 'doses', count(d.id),
                   'rate', case when count(d.id) = 0 then null else round(100.0 * count(d.id) filter (where imt__verified(d)) / count(d.id)) end) x
                 from imt_facilities f left join imt_doses d on d.facility_id = f.id and d.status = 'valid'
                   and (d.captured_at at time zone 'Africa/Lagos')::date >= v_week group by f.id, f.name) q), '[]'),
    'flags', coalesce((select jsonb_agg(imt__dose_json(id) order by captured_at desc) from
                 (select id, captured_at from imt_doses where flag_status = 'open' order by captured_at desc limit 5) x), '[]'));
end $$;

create function imt_sup_counts(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token, 'supervisor');
begin
  return jsonb_build_object('open_flags', (select count(*) from imt_doses where flag_status = 'open'),
    'stock_flags', (select count(*) from imt_outreach where jsonb_array_length(recon_flags) > 0 and closed_at > now() - interval '7 days'),
    'last_activity', (select max(at) from imt_activity));
end $$;

create function imt_sup_vaccinators(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token, 'supervisor');
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', v.id, 'name', v.full_name, 'username', v.username, 'facility', f.name,
      'online', v.last_seen > now() - interval '10 minutes', 'last_seen', v.last_seen, 'pending', v.pending_sync,
      'doses', (select count(*) from imt_doses d where d.vaccinator_id = v.id and d.status = 'valid'),
      'children', (select count(*) from imt_children c where c.registered_by = v.id),
      'verified_rate', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where imt__verified(d)) / count(*)) end
                        from imt_doses d where d.vaccinator_id = v.id and d.status = 'valid'),
      'otp_rate', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where d.otp_status = 'verified') / count(*)) end
                   from imt_doses d where d.vaccinator_id = v.id and d.status = 'valid'),
      'open_flags', (select count(*) from imt_doses d where d.vaccinator_id = v.id and d.flag_status = 'open'),
      'outreach', (select o.community from imt_outreach o where o.vaccinator_id = v.id and o.status = 'open' limit 1))
    order by v.full_name) from imt_users v left join imt_facilities f on f.id = v.facility_id where v.role = 'vaccinator'), '[]');
end $$;

create function imt_sup_activity(p_token text, p_vaccinator int default null, p_type text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token, 'supervisor');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'who', u2.full_name, 'role', u2.role, 'type', a.type, 'text', a.text) order by a.at desc)
    from (select * from imt_activity where (p_vaccinator is null or user_id = p_vaccinator) and (p_type is null or type = p_type)
          order by at desc limit 200) a join imt_users u2 on u2.id = a.user_id), '[]');
end $$;

create function imt_sup_flags(p_token text, p_status text default 'open') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token, 'supervisor');
begin
  return jsonb_build_object(
    'doses', coalesce((select jsonb_agg(imt__dose_json(id) order by captured_at desc) from
       (select id, captured_at from imt_doses where case when p_status = 'open' then flag_status = 'open' else flag_status <> 'none' end
        order by captured_at desc limit 200) x), '[]'),
    'outreach', coalesce((select jsonb_agg(imt__outreach_json(id) order by closed_at desc) from
       (select id, closed_at from imt_outreach where jsonb_array_length(recon_flags) > 0 order by closed_at desc limit 30) x), '[]'));
end $$;

create function imt_sup_dose_detail(p_token text, p_dose int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token, 'supervisor'); d imt_doses; v_prev_hash text; v_calc text; o imt_outreach; f imt_facilities;
begin
  select * into d from imt_doses where id = p_dose;
  if not found then raise exception 'Record not found.'; end if;
  select hash into v_prev_hash from imt_doses where id < d.id order by id desc limit 1;
  v_calc := encode(sha256(convert_to(d.prev_hash || d.sealed::text, 'UTF8')), 'hex');
  select * into o from imt_outreach where id = d.outreach_id;
  select * into f from imt_facilities where id = d.facility_id;
  return jsonb_build_object(
    'dose', imt__dose_json(d.id, true),
    'child', imt__child_json(d.child_id, true),
    'site', case when o.id is not null then jsonb_build_object('name', 'Planned site · ' || o.community, 'lat', o.site_lat, 'lng', o.site_lng, 'demo', o.demo_site)
                 else jsonb_build_object('name', 'Facility · ' || f.name, 'lat', f.lat, 'lng', f.lng, 'demo', false) end,
    'sealed', d.sealed,
    'integrity', jsonb_build_object('hash_ok', v_calc = d.hash, 'chain_ok', coalesce(v_prev_hash, 'GENESIS') = d.prev_hash,
                                    'photo_ok', (d.photo is null and d.sealed->>'photo_sha256' is null) or
                                                encode(sha256(convert_to(coalesce(d.photo, ''), 'UTF8')), 'hex') = d.sealed->>'photo_sha256'),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'who', u2.full_name, 'action', a.action, 'reason', a.reason,
                                        'before', a.before, 'after', a.after) order by a.at)
                       from imt_audit a left join imt_users u2 on u2.id = a.actor_id where a.dose_id = d.id), '[]'),
    'history', coalesce((select jsonb_agg(imt__dose_json(x.id) order by x.captured_at) from imt_doses x where x.child_id = d.child_id), '[]'));
end $$;

-- accept | amend | void — every supervisor change needs a reason and is logged
create function imt_sup_action(p_token text, p_dose int, p_action text, p_reason text, p_changes jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token, 'supervisor'); d imt_doses; v_before jsonb; v_after jsonb; b imt_batches;
begin
  select * into d from imt_doses where id = p_dose;
  if not found then raise exception 'Record not found.'; end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'Give a reason of at least 10 characters. It is stored in the audit trail.'; end if;
  if d.status = 'voided' then raise exception 'This record has already been voided.'; end if;
  v_before := jsonb_build_object('batch_id', d.batch_id, 'dose_no', d.dose_no, 'injection_site', d.injection_site,
                                 'flag_status', d.flag_status, 'status', d.status);
  perform set_config('imt.supervisor_action', 'on', true);
  if p_action = 'accept' then
    update imt_doses set flag_status = 'accepted' where id = d.id;
  elsif p_action = 'amend' then
    if (p_changes->>'batch_id') is not null then
      select * into b from imt_batches where id = (p_changes->>'batch_id')::int;
      if b.vaccine <> d.vaccine then raise exception 'Batch % is not %.', b.batch_no, d.vaccine; end if;
    end if;
    update imt_doses set batch_id = coalesce((p_changes->>'batch_id')::int, batch_id),
                         dose_no = coalesce((p_changes->>'dose_no')::int, dose_no),
                         injection_site = coalesce(nullif(p_changes->>'injection_site', ''), injection_site),
                         flag_status = 'amended' where id = d.id;
  elsif p_action = 'void' then
    update imt_doses set status = 'voided', flag_status = 'voided' where id = d.id;
  else
    raise exception 'Unknown action.';
  end if;
  perform set_config('imt.supervisor_action', 'off', true);
  select jsonb_build_object('batch_id', batch_id, 'dose_no', dose_no, 'injection_site', injection_site,
                            'flag_status', flag_status, 'status', status) into v_after from imt_doses where id = d.id;
  insert into imt_audit (dose_id, actor_id, action, reason, before, after) values (d.id, u.id, p_action, trim(p_reason), v_before, v_after);
  perform imt__log(u.id, 'Review', initcap(p_action) || case p_action when 'accept' then 'ed' when 'void' then 'ed' else 'ed' end
                   || ' ' || d.uid || ' · ' || left(trim(p_reason), 60));
  return imt_sup_dose_detail(p_token, d.id);
end $$;

-- Demonstrates the seal: tries a direct edit with no supervisor reason, and reports what the database did
create function imt_tamper_test(p_token text, p_dose int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token, 'supervisor'); v_msg text;
begin
  begin
    perform set_config('imt.supervisor_action', 'off', true);
    update imt_doses set dose_no = dose_no + 1, otp_status = 'verified' where id = p_dose;
    v_msg := 'NOT BLOCKED';
    raise exception 'rollback';
  exception when others then
    if v_msg is null then v_msg := sqlerrm; end if;
  end;
  insert into imt_audit (dose_id, actor_id, action, reason) values (p_dose, u.id, 'blocked-edit', 'Direct edit attempt blocked by the database seal');
  return jsonb_build_object('blocked', v_msg <> 'NOT BLOCKED', 'message', v_msg);
end $$;

create function imt_sup_stock(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token, 'supervisor');
begin
  return jsonb_build_object(
    'batches', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'vaccine', b.vaccine, 'batch_no', b.batch_no, 'expiry', b.expiry,
        'received', b.doses_received, 'doses_per_vial', v.doses_per_vial,
        'used', (select count(*) from imt_doses d where d.batch_id = b.id and d.status = 'valid'),
        'in_field', coalesce((select sum(i.vials_issued) * v.doses_per_vial from imt_outreach_items i join imt_outreach o on o.id = i.outreach_id
                              where i.batch_id = b.id and o.status = 'open'), 0),
        'left', imt__batch_left(b.id),
        'status', case when b.expiry < imt__today() then 'Expired'
                       when imt__batch_left(b.id) < 40 then 'Low — reorder'
                       when b.expiry < imt__today() + 60 then 'Watch — expiring'
                       else 'OK' end) order by v.sort, b.expiry)
      from imt_batches b join imt_vaccines v on v.name = b.vaccine), '[]'),
    'sessions', coalesce((select jsonb_agg(imt__outreach_json(id) order by started_at desc) from
      (select id, started_at from imt_outreach order by started_at desc limit 30) x), '[]'));
end $$;

create function imt_sup_defaulters(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token, 'supervisor');
begin
  return jsonb_build_object(
    'children', coalesce((select jsonb_agg(x order by (x->>'days_overdue')::int desc) from (
      select imt__child_json(c.id, false) || jsonb_build_object(
               'next', n, 'days_overdue', imt__today() - (n->>'due')::date,
               'overdue_count', (select count(*) from jsonb_array_elements(imt__due(c.id)) e where e->>'status' = 'overdue'),
               'last_reminder', (select max(at) from imt_sms s where s.child_id = c.id and s.kind = 'reminder')) x
      from imt_children c, lateral (select imt__next(c.id) n) q
      where n is not null and (n->>'due')::date < imt__today()) z), '[]'),
    'sms', coalesce((select jsonb_agg(jsonb_build_object('at', s.at, 'to', s.to_phone, 'kind', s.kind, 'message', s.message,
                    'child', c.first_name || ' ' || c.last_name) order by s.at desc)
      from (select * from imt_sms order by at desc limit 40) s left join imt_children c on c.id = s.child_id), '[]'));
end $$;

create function imt_send_reminder(p_token text, p_child int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token, 'supervisor'); c imt_children; n jsonb; v_msg text;
begin
  select * into c from imt_children where id = p_child;
  if not found then raise exception 'Child not found.'; end if;
  n := imt__next(c.id);
  v_msg := format('ImmunTrack: %s missed %s (due %s). Please visit %s or any Lagos State health facility with ID %s. Vaccines are free.',
                  c.first_name, coalesce(n->>'label', 'a scheduled vaccine'), to_char((n->>'due')::date, 'DD Mon'),
                  (select name from imt_facilities where id = c.facility_id), c.uid);
  insert into imt_sms (to_phone, child_id, kind, message, sent_by) values (c.guardian_phone, c.id, 'reminder', v_msg, u.id);
  perform imt__log(u.id, 'Reminder', 'Sent defaulter reminder · ' || c.first_name || ' ' || c.last_name);
  return jsonb_build_object('to', c.guardian_phone, 'message', v_msg);
end $$;

create function imt_sup_report(p_token text, p_month text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token, 'supervisor'); v_from date := (p_month || '-01')::date; v_to date := ((p_month || '-01')::date + interval '1 month')::date;
begin
  return jsonb_build_object('month', p_month,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('facility', f.name, 'vaccine', s.vaccine, 'dose_no', s.dose_no, 'label', s.label,
        'reported', (select count(*) from imt_doses d where d.facility_id = f.id and d.vaccine = s.vaccine and d.dose_no = s.dose_no and d.status = 'valid'
                     and (d.captured_at at time zone 'Africa/Lagos')::date >= v_from and (d.captured_at at time zone 'Africa/Lagos')::date < v_to),
        'verified', (select count(*) from imt_doses d where d.facility_id = f.id and d.vaccine = s.vaccine and d.dose_no = s.dose_no and imt__verified(d)
                     and (d.captured_at at time zone 'Africa/Lagos')::date >= v_from and (d.captured_at at time zone 'Africa/Lagos')::date < v_to))
        order by f.name, s.age_days, s.vaccine, s.dose_no)
      from imt_facilities f cross join imt_schedule s), '[]'),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('name', r.name, 'period', r.period, 'verification', r.verification,
                         'status', r.status, 'at', r.created_at) order by r.created_at desc) from imt_reports r), '[]'));
end $$;

create function imt_save_report(p_token text, p_name text, p_period text, p_verification numeric, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token, 'supervisor');
begin
  insert into imt_reports (name, period, verification, status, created_by) values (p_name, p_period, p_verification, p_status, u.id);
  perform imt__log(u.id, 'Report', p_status || ' · ' || p_name || ' · ' || p_period);
  return jsonb_build_object('ok', true);
end $$;

-- =====================================================================
-- Demo data
-- =====================================================================
create function imt__seed() returns void language plpgsql security definer set search_path = public as $$
declare
  v_first text[] := array['Ibrahim','Chidinma','Sade','Tunde','Ngozi','Amaka','Femi','Aisha','Emeka','Bisola','Kunle','Halima','Tobi','Zainab','Ifeanyi','Yetunde','Musa','Funmi','Dayo','Chiamaka','Segun','Hauwa','Kelechi','Ronke'];
  v_last text[] := array['Musa','Okafor','Alabi','Bakare','Umeh','Eze','Adebayo','Bello','Nwosu','Ogunleye','Lawal','Yusuf','Adeyemi','Okonkwo','Balogun','Ibrahim','Afolabi','Olawale','Nnaji','Salami','Ajayi','Abubakar','Obi','Coker'];
  v_comm text[]; c record; s record; v_child int; v_dob date; v_at timestamptz; v_fac int; v_vac int; v_batch int;
  v_today date := imt__today(); i int; v_flags jsonb; v_otp text; v_n int := 0; f record;
begin
  insert into imt_facilities (name, ward, lat, lng) values
    ('Igando HC', 'Igando', 6.5530, 3.2400),
    ('Egbeda Model PHC', 'Egbeda', 6.5920, 3.2910),
    ('Ikotun-Egbe PHC', 'Ikotun', 6.5490, 3.2650);
  insert into imt_communities (name, facility_id, lat, lng) values
    ('Igando', 1, 6.5536, 3.2385), ('Ikotun', 3, 6.5487, 3.2656), ('Egbe', 3, 6.5570, 3.2830),
    ('Egbeda', 2, 6.5915, 3.2920), ('Idimu', 2, 6.5830, 3.2720), ('Akowonjo', 2, 6.6010, 3.3040),
    ('Ijegun', 1, 6.5280, 3.2560), ('Isheri-Olofin', 1, 6.5440, 3.2300);
  insert into imt_users (username, pin_hash, full_name, role, facility_id, phone) values
    ('sbello',   imt__pin('1234'), 'S. Bello',   'vaccinator', 1, '08030000001'),
    ('rojo',     imt__pin('1234'), 'R. Ojo',     'vaccinator', 2, '08030000002'),
    ('ayusuf',   imt__pin('1234'), 'A. Yusuf',   'vaccinator', 3, '08030000003'),
    ('fadeyemi', imt__pin('1234'), 'F. Adeyemi', 'vaccinator', 3, '08030000004'),
    ('supervisor', imt__pin('2026'), 'Babajide Arulogun', 'supervisor', null, '08030000009');
  insert into imt_vaccines values
    ('BCG', 20, 'Intradermal', 'Left upper arm', 1), ('HepB', 10, 'Intramuscular', 'Right thigh', 2),
    ('OPV', 20, 'Oral', 'Oral', 3), ('Pentavalent', 10, 'Intramuscular', 'Left thigh', 4),
    ('PCV', 4, 'Intramuscular', 'Right thigh', 5), ('Rotavirus', 1, 'Oral', 'Oral', 6),
    ('IPV', 5, 'Intramuscular', 'Right thigh', 7), ('Measles', 10, 'Subcutaneous', 'Left upper arm', 8),
    ('Yellow Fever', 10, 'Subcutaneous', 'Right upper arm', 9), ('MenA', 10, 'Intramuscular', 'Left thigh', 10),
    ('Malaria', 2, 'Intramuscular', 'Left thigh', 11);
  -- Nigeria routine schedule (NPHCDA). Upper age limits: BCG 11 months and OPV 0 two weeks (NPHCDA);
  -- HepB birth dose 2 weeks (NPHCDA says within 24 hours; 2 weeks allowed for outreach — team to confirm);
  -- Rotavirus 24 months, Penta and PCV 5 years (WHO). Others have no upper limit.
  insert into imt_schedule (vaccine, dose_no, age_days, label, max_age_days) values
    ('BCG',1,0,'BCG',334), ('HepB',0,0,'HepB birth',14), ('OPV',0,0,'OPV 0',14),
    ('OPV',1,42,'OPV 1',null), ('Pentavalent',1,42,'Penta 1',1825), ('PCV',1,42,'PCV 1',1825), ('Rotavirus',1,42,'Rota 1',730), ('IPV',1,42,'IPV 1',null),
    ('OPV',2,70,'OPV 2',null), ('Pentavalent',2,70,'Penta 2',1825), ('PCV',2,70,'PCV 2',1825), ('Rotavirus',2,70,'Rota 2',730),
    ('OPV',3,98,'OPV 3',null), ('Pentavalent',3,98,'Penta 3',1825), ('PCV',3,98,'PCV 3',1825), ('Rotavirus',3,98,'Rota 3',730), ('IPV',2,98,'IPV 2',null),
    ('Malaria',1,150,'Malaria 1',null), ('Malaria',2,180,'Malaria 2',null), ('Malaria',3,210,'Malaria 3',null),
    ('Measles',1,270,'Measles 1',null), ('Yellow Fever',1,270,'Yellow Fever',null), ('MenA',1,270,'MenA',null),
    ('Measles',2,450,'Measles 2',null), ('Malaria',4,450,'Malaria 4',null);
  insert into imt_batches (vaccine, batch_no, expiry, doses_received, received_at) values
    ('BCG', 'BC2026-044', v_today + 70, 400, v_today - 120),
    ('HepB', 'HB2026-019', v_today + 200, 300, v_today - 120),
    ('OPV', 'OP2026-071', v_today + 40, 500, v_today - 120),
    ('Pentavalent', 'PV2026-118', v_today + 150, 500, v_today - 120),
    ('PCV', 'PC2026-033', v_today + 180, 400, v_today - 120),
    ('Rotavirus', 'RT2026-012', v_today + 160, 400, v_today - 120),
    ('IPV', 'IP2026-027', v_today + 190, 200, v_today - 120),
    ('Measles', 'MS2026-009', v_today + 75, 68, v_today - 120),
    ('Yellow Fever', 'YF2026-015', v_today + 220, 150, v_today - 120),
    ('MenA', 'MA2026-006', v_today + 240, 150, v_today - 120),
    ('Malaria', 'ML2026-021', v_today + 210, 200, v_today - 120);

  -- children with plausible histories
  for i in 1..48 loop
    -- each child has a scheduled visit falling in the last week, so the dashboard has a realistic week
    v_dob := v_today - ((array[0, 42, 70, 98, 270, 450])[1 + (i % 6)] + (i % 7) + case when i % 6 = 0 then 2 else 0 end);
    v_fac := 1 + (i % 3);
    v_vac := case v_fac when 1 then 1 when 2 then 2 else 3 + (i % 2) end;
    v_comm := array(select name from imt_communities where facility_id = v_fac);
    insert into imt_children (uid, first_name, last_name, dob, sex, lasra_id, birth_cert_no, guardian_name, guardian_phone,
                              community, facility_id, registered_by, created_at)
    values ('IMT-LAG-AL-' || lpad(nextval('imt_child_seq')::text, 5, '0'), v_first[1 + (i - 1) % 24], v_last[1 + (i * 7) % 24], v_dob,
            case when i % 2 = 0 then 'Female' else 'Male' end,
            case when i % 4 = 0 then null else 'LASRA-2026-' || lpad((3900 + i * 13)::text, 6, '0') end,
            case when i % 3 = 0 then null else 'NPC/LA/' || (2025 + (i % 2)) || '/' || lpad((10400 + i * 7)::text, 6, '0') end,
            case when i % 2 = 0 then 'Mrs. ' else 'Mr. ' end || substr(v_first[1 + (i * 5) % 24], 1, 1) || '. ' || v_last[1 + (i * 7) % 24],
            '080' || lpad((31000000 + i * 4111)::text, 8, '0'),
            v_comm[1 + (i % array_length(v_comm, 1))], v_fac, v_vac, (v_dob + 1)::timestamptz + interval '10 hours')
    returning id into v_child;
  end loop;

  -- doses: everything due up to ~12 days ago was given on time; some recent catch-up; a few left as defaulters
  for c in select ch.*, u2.id as vac_id from imt_children ch join imt_users u2 on u2.id = ch.registered_by order by ch.id loop
    for s in select sc.* from imt_schedule sc join imt_vaccines v on v.name = sc.vaccine order by sc.age_days, v.sort loop
      continue when c.dob + s.age_days > v_today;
      -- defaulters: every 5th child missed its most recent visit
      continue when c.id % 5 = 0 and c.dob + s.age_days >= v_today - 40;
      v_at := ((c.dob + s.age_days + (c.id % 2))::timestamp at time zone 'Africa/Lagos') + interval '9 hours'
              + (c.id * interval '5 minutes') + (s.dose_no * interval '3 minutes');
      if v_at > now() then v_at := ((c.dob + s.age_days)::timestamp at time zone 'Africa/Lagos') + interval '8 hours' + (c.id * interval '2 minutes'); end if;
      continue when v_at > now();
      select id into v_batch from imt_batches where vaccine = s.vaccine limit 1;
      select * into f from imt_facilities where id = c.facility_id;
      v_n := v_n + 1;
      v_flags := '[]'; v_otp := 'verified';
      if v_at > now() - interval '7 days' and c.registered_by = 2 and v_n % 3 = 0 then
        v_otp := 'pending'; v_flags := jsonb_build_array(jsonb_build_object('code', 'OTP_PENDING', 'text', 'No guardian OTP confirmation (captured offline)'));
      end if;
      insert into imt_doses (uid, child_id, vaccine, dose_no, batch_id, injection_site, vaccinator_id, facility_id,
                             lat, lng, gps_accuracy, distance_m, captured_at, received_at, otp_status, flags, flag_status)
      values ('DOSE-' || to_char(v_at at time zone 'Africa/Lagos', 'YYMMDD') || '-' || nextval('imt_dose_seq'), c.id, s.vaccine, s.dose_no, v_batch,
              (select default_site from imt_vaccines where name = s.vaccine), c.vac_id, c.facility_id,
              f.lat + ((c.id % 7) - 3) * 0.0011, f.lng + ((c.id % 5) - 2) * 0.0012, 12 + (c.id % 20), 150 + (c.id * 37) % 500,
              v_at, v_at + interval '40 seconds', v_otp, v_flags, case when jsonb_array_length(v_flags) > 0 then 'open' else 'none' end);
    end loop;
  end loop;

  -- three hand-placed flags, like the ones a supervisor would really see
  perform set_config('imt.supervisor_action', 'on', true);
  update imt_doses set flags = jsonb_build_array(jsonb_build_object('code', 'GPS_MISMATCH', 'text', 'GPS mismatch: recorded 6.8 km from planned site Igando')),
         flag_status = 'open', lat = 6.6018, lng = 3.2899, distance_m = 6800
   where id = (select id from imt_doses where vaccinator_id = 1 and captured_at > now() - interval '7 days' order by captured_at desc limit 1);
  update imt_doses set flags = jsonb_build_array(jsonb_build_object('code', 'RAPID_ENTRY', 'text', 'Entered 12 seconds after a dose for a different child — too fast for a real vaccination')),
         flag_status = 'open'
   where id = (select id from imt_doses where vaccinator_id = 3 and captured_at > now() - interval '7 days' order by captured_at desc limit 1);
  update imt_doses set flags = jsonb_build_array(jsonb_build_object('code', 'NO_FACE', 'text', 'No face photo captured at point of care')),
         flag_status = 'open'
   where id = (select id from imt_doses where vaccinator_id = 4 and captured_at > now() - interval '7 days' order by captured_at desc limit 1);
  perform set_config('imt.supervisor_action', 'off', true);

  -- recent activity so the feed is not empty
  insert into imt_activity (at, user_id, type, text)
  select d.received_at, d.vaccinator_id, 'Dose', 'Recorded ' || imt__label(d.vaccine, d.dose_no) || ' · ' || ch.first_name || ' ' || ch.last_name
         || case when d.flag_status = 'open' then ' · flagged' else ' · verified' end
  from imt_doses d join imt_children ch on ch.id = d.child_id where d.captured_at > now() - interval '3 days';
  update imt_users set last_seen = now() - interval '2 hours', pending_sync = 6 where username = 'rojo';

  -- a closed outreach with a stock discrepancy, to show reconciliation
  insert into imt_outreach (vaccinator_id, facility_id, community, site_lat, site_lng, started_at, closed_at, status, recon, recon_flags)
  values (2, 2, 'Idimu', 6.5830, 3.2720, now() - interval '2 days 8 hours', now() - interval '2 days', 'closed',
    jsonb_build_object('items', jsonb_build_array(
      jsonb_build_object('batch_id', 8, 'batch_no', 'MS2026-009', 'vaccine', 'Measles', 'issued', 4, 'unused', 1, 'empty', 3, 'capacity', 30, 'recorded', 4, 'wasted', 26, 'wastage_pct', 87))),
    jsonb_build_array(jsonb_build_object('code', 'HIGH_WASTAGE', 'batch_no', 'MS2026-009',
      'text', 'Measles MS2026-009: 87% wastage (26 of 30 doses unaccounted) — possible vial dumping')));
  insert into imt_outreach_items (outreach_id, batch_id, vials_issued, vials_unused, vials_empty)
  values (currval('imt_outreach_id_seq'), 8, 4, 1, 3);

  insert into imt_reports (name, period, verification, status, created_by, created_at) values
    ('Monthly coverage — Alimosho', to_char(v_today - 60, 'Mon YYYY'), 94, 'Submitted', 5, now() - interval '40 days'),
    ('Quarterly QA summary', 'Q3 ' || to_char(v_today, 'YYYY'), 91, 'Submitted', 5, now() - interval '30 days');
end $$;

create function imt_reset_demo(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u imt_users := imt__auth(p_token, 'supervisor');
begin
  truncate imt_audit, imt_sms, imt_otps, imt_activity, imt_reports, imt_outreach_items, imt_outreach, imt_doses, imt_children,
           imt_tokens, imt_users, imt_batches, imt_schedule, imt_vaccines, imt_communities, imt_facilities restart identity cascade;
  perform setval('imt_child_seq', 8840, false);
  perform setval('imt_dose_seq', 1000, false);
  perform imt__seed();
  return jsonb_build_object('ok', true, 'message', 'Demo data reset. Please sign in again.');
end $$;

-- ---------- permissions: only the public imt_ functions are callable ----------
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'imt\_%' loop
    execute 'revoke all on function ' || r.f || ' from public, anon, authenticated';
    if r.proname not like 'imt\_\_%' then
      execute 'grant execute on function ' || r.f || ' to anon, authenticated';
    end if;
  end loop;
end $$;

-- ---------- load the demo data ----------
select imt__seed();
