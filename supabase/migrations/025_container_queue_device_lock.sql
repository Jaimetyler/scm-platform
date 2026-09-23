alter table public.container_gate_queue
  add column if not exists device_token_hash text;

create unique index if not exists idx_container_gate_queue_one_waiting_per_device
  on public.container_gate_queue (device_token_hash)
  where queue_status = 'waiting' and device_token_hash is not null;
