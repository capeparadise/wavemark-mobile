-- Preserve advanced rating categories; additive and safe for existing clients.
alter table public.listen_list
  add column if not exists rating_details jsonb;
