import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const sql = readFileSync(new URL('../supabase/migrations/047_cotton_finish_fallback.sql', import.meta.url), 'utf8');
const old = readFileSync(new URL('../supabase/migrations/046_staff_outside_carrier_checkout.sql', import.meta.url), 'utf8');
const signature = 'uuid,text,text,timestamptz,uuid,uuid,uuid,uuid';

test('047 adds only the service-role automatic completion RPC', () => {
  assert.match(sql, /begin;\s*create function public\.complete_inbound_outside_carrier_auto\(/);
  assert.match(sql, /language plpgsql security invoker set search_path=public/);
  assert.ok(sql.includes(`revoke all on function public.complete_inbound_outside_carrier_auto(${signature}) from public,anon,authenticated;`));
  assert.ok(sql.includes(`grant execute on function public.complete_inbound_outside_carrier_auto(${signature}) to service_role;`));
  assert.doesNotMatch(sql, /create or replace|alter table|drop |disable trigger|delete from/i);
  assert.match(sql, /commit;\s*$/);
});

test('automatic provenance does not invent a staff acknowledgment or accept a client reason', () => {
  assert.doesNotMatch(sql, /p_acknowledge_unresolved|p_reason|Staff acknowledged/);
  assert.match(sql, /fallback_reason constant text := 'Outside-carrier fallback applied during staff Finish cotton; McLeod verification incomplete; no McLeod update\.'/);
  assert.match(sql, /No separate staff acknowledgment was requested or recorded/);
  assert.match(sql, /fallback_provenance,\s*'unresolved',existing\.mcleod_lookup_failure_code/);
});

test('actor and locked yard checks precede idempotent replay, which precedes revision rejection', () => {
  const actor = sql.indexOf('select * into actor');
  const row = sql.indexOf('select * into existing');
  const replay = sql.indexOf('if previous.request_id=p_request_id');
  const revision = sql.indexOf('if existing.updated_at is distinct');
  assert.ok(actor < row && row < replay && replay < revision);
  assert.match(sql, /id=p_staff_id and user_id=p_user_id\s*and status='active' and \(role='admin' or \(role='operator' and terminal=p_terminal\)\) for share/);
  assert.match(sql, /id=p_id and terminal=p_terminal and site_code=p_site_code for update/);
  for (const condition of ['previous.lookup_attempt_id=p_lookup_attempt_id', 'previous.actor_id=p_staff_id', 'previous.actor_user_id=p_user_id', 'previous.reason=fallback_reason', 'previous.acknowledgement=fallback_provenance', 'existing.outside_carrier_override_request_id=p_request_id']) assert.ok(sql.includes(condition));
  assert.match(sql, /p_request_id is null or p_lookup_attempt_id is null or p_expected_updated_at is null/);
});

test('automatic fallback preserves every 046 eligibility guard and strengthens nullable verification', () => {
  const slice = source => source.slice(source.indexOf("  if existing.draft_status is distinct from 'failed'"), source.indexOf('  update public.inbound_checkin_rows set draft_status='));
  assert.equal(slice(sql).replace(/\r\n/g, '\n'), slice(old).replace('or not existing.verified then', 'or existing.verified is distinct from true then').replace(/\r\n/g, '\n'));
});

test('receiving update and immutable audit stay atomic without changing lookup evidence or driver details', () => {
  const update = sql.slice(sql.indexOf('  update public.inbound_checkin_rows set draft_status='), sql.indexOf('  insert into public.inbound_outside_carrier_events'));
  assert.match(update, /draft_status='outside_carrier'/);
  assert.match(update, /yard_status='completed'/);
  assert.match(update, /outside_carrier_override_request_id=p_request_id/);
  assert.doesNotMatch(update, /mcleod_lookup_status\s*=|mcleod_lookup_attempt_id\s*=|mcleod_processing_phase\s*=|matched_order_id\s*=|matched_stop_id\s*=|driver_name\s*=|driver_phone\s*=|photo_path\s*=/);
  assert.match(sql, /lookup_failure_code,lookup_failed_at,before_values,after_values/);
  assert.match(sql, /to_jsonb\(existing\),to_jsonb\(saved\)/);
  assert.doesNotMatch(sql, /exception when/i);
  assert.ok(sql.indexOf('insert into public.inbound_outside_carrier_events') < sql.lastIndexOf('return next saved'));
});
