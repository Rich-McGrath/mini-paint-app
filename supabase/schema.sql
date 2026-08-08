-- Studioshot — flat data model (SPEC §5): one image = one miniature = one kit tag.
-- Run once against the Supabase project. The Worker writes with the service-role key;
-- no client ever talks to Postgres directly, so RLS stays enabled with no public policies.

create table if not exists images (
  id uuid primary key,
  user_id text not null,             -- anonymous id or Supabase Auth user id, from day one
  kit_tag text,                      -- v2: the kit index hangs off this
  original_key text not null,        -- R2: originals/{id}   (short retention)
  original_type text not null,
  cutout_key text,                   -- R2: cutouts/{id}.png
  corrected_mask_key text,           -- R2: masks/{id}.png   (the flywheel — kept)
  provider text,                     -- segmentation model identifier, for the bake-off
  status text not null default 'uploaded'
    check (status in ('uploaded', 'cutout', 'corrected')),
  created_at timestamptz not null default now()
);

create index if not exists images_user_id_idx on images (user_id, created_at desc);

alter table images enable row level security;

-- Access is explicit ("Automatically expose new tables" is disabled in the
-- project settings). Only the Worker's service role touches this table; the
-- public Data API roles get nothing.
revoke all on table images from anon, authenticated;
grant select, insert, update on table images to service_role;

-- Optional accounts: username reserved at sign-up, unique forever (SPEC §5).
create table if not exists usernames (
  user_id uuid primary key,              -- Supabase Auth user id
  username text not null unique
    check (username ~ '^[a-zA-Z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);

alter table usernames enable row level security;
revoke all on table usernames from anon, authenticated;
grant select, insert, update on table usernames to service_role;
