-- Supabase Schema for Print Kiosk
-- Run this in the Supabase SQL Editor (takes 5 seconds)

-- 1. Create sessions table
create table if not exists public.sessions (
  code text primary key,
  status text not null default 'waiting',
  mode text not null default 'receive',
  files jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  expires_at timestamp with time zone default (timezone('utc'::text, now()) + interval '3 minutes') not null
);

-- Enable RLS (Row Level Security) with public access policy for kiosk use
alter table public.sessions enable row level security;

drop policy if exists "Public sessions read/write" on public.sessions;
create policy "Public sessions read/write"
on public.sessions
for all
to anon, authenticated
using (true)
with check (true);

-- Enable Realtime broadcast and Postgres Changes for sessions
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sessions'
  ) then
    alter publication supabase_realtime add table public.sessions;
  end if;
end $$;

-- 2. Create the storage bucket for kiosk documents (public)
insert into storage.buckets (id, name, public, file_size_limit)
values (
  'documents',
  'documents',
  true,
  52428800 -- 50MB per file
)
on conflict (id) do update set public = true;

-- Storage policies allowing public uploads and downloads
drop policy if exists "Public upload to documents" on storage.objects;
create policy "Public upload to documents"
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'documents');

drop policy if exists "Public read from documents" on storage.objects;
create policy "Public read from documents"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'documents');

drop policy if exists "Public delete from documents" on storage.objects;
create policy "Public delete from documents"
on storage.objects for delete
to anon, authenticated
using (bucket_id = 'documents');
