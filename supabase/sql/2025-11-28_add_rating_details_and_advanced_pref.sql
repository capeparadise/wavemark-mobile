-- Add rating_details to listen_list and advanced_ratings_enabled to profiles
-- Safe to run multiple times

alter table if exists public.listen_list
  add column if not exists rating_details jsonb;

alter table if exists public.profiles
  add column if not exists advanced_ratings_enabled boolean;

-- Optional: create a small check constraint to validate values 1..10 if desired (skipped to keep lightweight)
