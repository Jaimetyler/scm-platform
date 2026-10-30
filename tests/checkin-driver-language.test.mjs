import test from 'node:test';
import assert from 'node:assert/strict';
import { translateDriverText, translateDriverError } from '../lib/inbound/checkin/driver-language.ts';
test('Spanish messages preserve operational meaning and identifiers without exposing untranslated errors',()=>{
  assert.match(translateDriverText('Pickup already completed in McLeod','es'),/recolección.*McLeod/);
  assert.match(translateDriverText('SCM order found: delivery. Please verify your trucking company and driver details below.','es'),/entrega/);
  assert.equal(translateDriverText(' · Phone ending 0100','es'),' · Teléfono terminado en 0100');
  assert.equal(translateDriverText('Pat, this is your','es'),'Pat, esta es su');
  assert.match(translateDriverError('Your location expired. Please try checking in again.','es'),/ubicación venció/);
  assert.doesNotMatch(translateDriverError('Unhandled vendor error','es'),/Unhandled|vendor/);
  assert.equal(translateDriverError('Unhandled vendor error','en'),'Unhandled vendor error');
});
