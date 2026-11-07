import { test } from 'node:test';
import assert from 'node:assert/strict';
import {MemoryDB, runtime} from './runtime.ts';
const {withinWindow,validateFlow,followerState,nextFollowup} = runtime(new MemoryDB(),fetch).load('lib/automation.ts') as typeof import('../lib/automation.ts');

const now = Date.parse('2026-11-07T12:00:00Z');
test('janela exige interação real anterior, estritamente abaixo de 24h', () => {
  assert.equal(withinWindow(null, now), false);
  assert.equal(withinWindow('invalid', now), false);
  assert.equal(withinWindow(new Date(now + 1).toISOString(), now), false);
  assert.equal(withinWindow(new Date(now - 86400000).toISOString(), now), false);
  assert.equal(withinWindow(new Date(now - 86399999).toISOString(), now), true);
});
test('seguidor só é confirmado por booleano explícito', () => {
  assert.equal(followerState({ is_user_follow_business: true }), 'following');
  assert.equal(followerState({ is_user_follow_business: false }), 'not_following');
  for (const value of [{}, null, {is_user_follow_business:'true'}, {error:{code:10}}]) {
    assert.equal(followerState(value), 'unavailable');
  }
});
const steps = [{type:'message', text:'Oi', button_label:'Quero'}, {type:'link', text:'Aqui', link_url:'https://example.com', link_label:'Abrir'}];
test('valida fluxo legado e sequência com intervalos personalizados', () => {
  assert.equal(validateFlow({steps}), null);
  assert.equal(validateFlow({steps, followup_steps:[{text:'Oferta', delay_minutes:1440}]}), null);
  for (const delay_minutes of [-1, 0, NaN, Infinity, '10']) {
    assert.ok(validateFlow({steps, followup_steps:[{text:'Oi', delay_minutes}]}));
  }
  assert.ok(validateFlow({steps:[{...steps[1], link_url:'javascript:alert(1)'}]}));
  assert.ok(validateFlow({steps:[steps[1]], require_follow:true}));
  assert.ok(validateFlow({steps:[], followup_steps:[]}));
});
test('próximo follow-up parte do envio confirmado e encerra sequência', () => {
  const flow = [{text:'A',delay_minutes:10},{text:'B',delay_minutes:120}];
  assert.deepEqual({...nextFollowup(flow, -1, now)}, {index:0, send_after:new Date(now+600000).toISOString()});
  assert.deepEqual({...nextFollowup(flow, 0, now)}, {index:1, send_after:new Date(now+7200000).toISOString()});
  assert.equal(nextFollowup(flow, 1, now), null);
});
