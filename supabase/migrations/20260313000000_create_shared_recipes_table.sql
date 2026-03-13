-- Shared recipes table: stores anonymized recipe JSON for public sharing.
--
-- Each row is a short-lived, publicly-readable recipe snapshot created when a
-- user clicks "Share" in the Pantry dashboard. Rows automatically expire after
-- SHARE_EXPIRY_DAYS (default 30) days — the backend enforces this at read time
-- by filtering `expires_at > now()`. Embeddings and personal tags are NEVER
-- stored here; the backend strips them before insertion.

create table if not exists public.shared_recipes (
    id          text        primary key,   -- 8-char URL-safe ID (secrets.token_urlsafe)
    recipe_json jsonb       not null,      -- Recipe sans embedding and tags
    created_at  timestamptz default now(),
    expires_at  timestamptz not null       -- Set by backend based on SHARE_EXPIRY_DAYS env var
);

-- Row Level Security: allow public unauthenticated reads of non-expired rows.
-- All backend reads/writes use the service-role key (bypasses RLS), so this
-- policy primarily protects direct anon-key Supabase access.
alter table public.shared_recipes enable row level security;

create policy "Public read non-expired shared recipes"
    on public.shared_recipes
    for select
    using (expires_at > now());

-- Index for fast single-row lookups by ID (primary key already covers this),
-- plus an expiry index for potential future background cleanup jobs.
create index if not exists shared_recipes_expires_idx
    on public.shared_recipes (expires_at);
