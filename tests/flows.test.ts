/* eslint-disable @typescript-eslint/no-explicit-any */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {MemoryDB,runtime} from './runtime.ts';

function fixture() {
  const db=new MemoryDB();
  db.tables.accounts.push({id:'account-a',ig_user_id:'ig-a',access_token:'token-a'});
  db.tables.automations.push({id:'auto-a',account_id:'account-a',active:true,trigger_comment:true,trigger_dm:true,keywords:['guia'],match_type:'contains',require_follow:true,steps:[{type:'message',text:'Siga e confirme',button_label:'Confirmar'},{type:'link',text:'Seu guia',link_label:'Abrir',link_url:'https://example.com/guia'}],followup_steps:[{text:'Mais conteúdo',delay_minutes:10},{text:'Oferta',delay_minutes:120}]});
  const sent:any[]=[];
  let profile:any={is_user_follow_business:true};
  let sendError:any=null;
  const rt=runtime(db, (async (url:any,init:any)=>{
    if(init?.method==='POST') {
      sent.push({url:String(url),body:JSON.parse(init.body)});
      if(sendError==='timeout')throw new Error('Timeout de envio');
      if(sendError)return Response.json({error:{is_transient:true}},{status:429});
      return Response.json({message_id:'meta-id'});
    }
    if (profile === 'timeout') throw new Error('Consulta indisponível');
    if (profile instanceof Response) return profile.clone();
    return Response.json(profile);
  }) as typeof fetch);
  const webhook=rt.load('app/api/webhook/route.ts');
  const drain=rt.load('app/api/cron/drain/route.ts');
  async function event(value:any) {
    const raw=JSON.stringify({entry:[{id:'ig-a',time:Math.floor(Date.now()/1000),...value}]});
    const sig='sha256='+createHmac('sha256',rt.env.IG_APP_SECRET).update(raw).digest('hex');
    const res=await webhook.POST(new Request('https://app.test/api/webhook',{method:'POST',headers:{'x-hub-signature-256':sig},body:raw}));
    assert.equal(res.status,200,await res.text());
  }
  const comment=()=>event({changes:[{field:'comments',value:{id:'comment-1',from:{id:'person-1'},media:{id:'reel-1'},text:'guia'}}]});
  const click=(mid='click-1',payload?:string)=>event({messaging:[{sender:{id:'person-1'},timestamp:Date.now(),message:{mid,text:'Já segui',quick_reply:{payload:payload||`RUN_${db.tables.automation_runs[0].id}_1`}}}]});
  const tick=async()=>{const res=await drain.POST(new Request('https://app.test/api/cron/drain',{method:'POST',headers:{'x-cron-secret':rt.env.CRON_SECRET}}));assert.equal(res.status,200,await res.text());};
  return {db,sent,comment,click,tick,event,rt,setProfile:(p:any)=>{profile=p;},setError:(p:any)=>{sendError=p;}};
}

test('comentário → convite → verificação → link → sequência; reentregas não duplicam',async()=>{
  const f=fixture();
  await Promise.all([f.comment(),f.comment()]);
  assert.equal(f.db.tables.queue.length,1);
  assert.equal(f.db.tables.contacts[0].last_reply_at,undefined);
  await Promise.all([f.tick(),f.tick()]);
  assert.equal(f.sent.length,1);
  assert.equal(f.sent[0].body.message.quick_replies[0].title,'Já segui ✅');
  assert.equal(f.db.tables.queue.filter(q=>q.kind==='sequence').length,0);
  await Promise.all([f.click(),f.click()]);
  assert.equal(f.db.tables.queue.filter(q=>q.kind==='verify_follow').length,1);
  await f.tick(); // consulta cria link
  assert.equal(f.sent.length,1);
  await f.tick(); // link confirmado cria primeiro follow-up
  assert.equal(f.sent.length,2);
  const link=f.db.tables.queue.find(q=>q.payload.delivery_type==='link');
  const seq=f.db.tables.queue.find(q=>q.kind==='sequence');
  assert.equal(Date.parse(seq.send_after)-Date.parse(link.sent_at),600000);
  await f.tick();assert.equal(f.sent.length,2);
  seq.send_after=new Date(Date.now()-1000).toISOString();
  await f.tick();assert.equal(f.sent.length,3);
  assert.equal(f.db.tables.queue.filter(q=>q.kind==='sequence').length,2);
});

for(const [label,profile] of [['não segue',{is_user_follow_business:false}],['campo ausente',{}],['resposta textual',{is_user_follow_business:'true'}]] as const) {
  test(`verificação ${label} bloqueia link, permite nova tentativa`,async()=>{
    const f=fixture();f.setProfile(profile);
    await f.comment();await f.tick();await f.click();await f.tick();
    assert.equal(f.db.tables.queue.filter(q=>q.payload.delivery_type==='link').length,0);
    assert.equal(f.sent.length,2);
    assert.match(f.sent[1].body.message.quick_replies[0].payload,/^RUN_/);
    f.setProfile({is_user_follow_business:true});
    await f.click('retry-2');await f.tick();await f.tick();
    assert.equal(f.db.tables.queue.filter(q=>q.payload.delivery_type==='link'&&q.status==='sent').length,1);
  });
}

test('pausar suspende fila e retomar checa novamente janela; campanha alheia não avança',async()=>{
  const f=fixture();await f.comment();
  f.db.tables.automations[0].active=false;await f.tick();assert.equal(f.sent.length,0);
  f.db.tables.automations[0].active=true;await f.tick();
  await f.click('bad','RUN_00000000-0000-0000-0000-000000000000_1');
  assert.equal(f.db.tables.queue.length,1);
  await f.click();f.db.tables.contacts[0].last_reply_at=new Date(Date.now()-86400000).toISOString();
  await f.tick();assert.equal(f.sent.length,1);
  assert.equal(f.db.tables.queue.at(-1).status,'skipped');
});

test('follow-up fora de 24h não envia nem continua sequência',async()=>{
  const f=fixture();await f.comment();await f.tick();await f.click();await f.tick();await f.tick();
  const seq=f.db.tables.queue.find(q=>q.kind==='sequence');seq.send_after=new Date(Date.now()-1000).toISOString();
  f.db.tables.contacts[0].last_reply_at=new Date(Date.now()-86400001).toISOString();
  await f.tick();assert.equal(seq.status,'skipped');assert.equal(f.sent.length,2);
  assert.equal(f.db.tables.queue.filter(q=>q.kind==='sequence').length,1);
});

test('rejeição transitória tem backoff; timeout não repete envio',async()=>{
  const f=fixture();await f.comment();f.setError(true);await f.tick();
  assert.equal(f.db.tables.queue[0].status,'pending');assert.equal(f.db.tables.queue[0].attempts,1);
  await f.tick();assert.equal(f.sent.length,1);
  f.db.tables.queue[0].send_after=new Date(Date.now()-1000).toISOString();
  f.setError('timeout');await f.tick();assert.equal(f.db.tables.queue[0].status,'failed');
  await f.tick();assert.equal(f.sent.length,2);
});

test('eco/recibo não abre janela e resposta privada expirada não envia',async()=>{
  const f=fixture();await f.event({messaging:[{sender:{id:'person-1'},timestamp:Date.now(),message:{is_echo:true,mid:'echo-1',text:'guia'}}]});
  assert.equal(f.db.tables.contacts.length,0);
  await f.comment();f.db.tables.queue[0].payload.occurred_at=new Date(Date.now()-7*86400000).toISOString();
  await f.tick();assert.equal(f.sent.length,0);assert.equal(f.db.tables.queue[0].status,'skipped');
});

test('edição preserva snapshot e recuperação não repete link confirmado',async()=>{
  const f=fixture();await f.comment();await f.tick();
  f.db.tables.automations[0].steps=[{type:'link',text:'Mudou',link_label:'Outro',link_url:'https://example.com/outro'}];
  // Em memória também simula serialização JSON que o Postgres faz no snapshot.
  await f.click();await f.tick();await f.tick();
  assert.equal(f.sent[1].body.message.attachment.payload.buttons[0].url,'https://example.com/guia');
  const link=f.db.tables.queue.find(q=>q.payload.delivery_type==='link');
  link.continued_at=null;
  await f.tick();assert.equal(f.sent.length,2);
  assert.equal(f.db.tables.queue.filter(q=>q.kind==='sequence').length,1);
});

test('botão antes de convite enviado não avança e claim travado vira falha incerta',async()=>{
  const f=fixture();await f.comment();await f.click();
  assert.equal(f.db.tables.queue.length,1);
  const job=f.db.tables.queue[0];job.status='sending';job.claimed_at=new Date(Date.now()-11*60000).toISOString();
  await f.tick();assert.equal(job.status,'failed');assert.equal(f.sent.length,0);
  assert.match(job.error,/incerto/);
});

test('contas diferentes não compartilham contato nem janela',async()=>{
  const f=fixture();
  f.db.tables.accounts.push({id:'account-b',ig_user_id:'ig-b',access_token:'token-b'});
  f.db.tables.contacts.push({id:'other-contact',account_id:'account-b',ig_scoped_id:'person-1',last_reply_at:new Date().toISOString()});
  await f.comment();await f.tick();
  assert.equal(f.db.tables.contacts.length,2);
  assert.equal(f.db.tables.contacts.find(c=>c.account_id==='account-a').last_reply_at,undefined);
  assert.match(f.sent[0].url,/token-a/);
});

test('reentrega atrasada não reabre a janela pelo horário de recebimento',async()=>{
  const f=fixture();const occurred=new Date(Date.now()-25*3600000);
  await f.event({messaging:[{sender:{id:'person-1'},timestamp:occurred.getTime(),message:{mid:'old-dm',text:'guia'}}]});
  assert.equal(f.db.tables.contacts[0].last_reply_at,occurred.toISOString());
  await f.tick();assert.equal(f.sent.length,0);assert.equal(f.db.tables.queue[0].status,'skipped');
});

test('duplicar campanha preserva configuração e cria cópia pausada sem execuções',async()=>{
  const f=fixture();const route=f.rt.load('app/api/automations/[id]/route.ts');
  const res=await route.POST(new Request('https://app.test/api/automations/auto-a',{method:'POST'}),{params:Promise.resolve({id:'auto-a'})});
  assert.equal(res.status,201);
  const {automation:copy}=await res.json();
  assert.equal(copy.active,false);assert.notEqual(copy.id,'auto-a');assert.equal(copy.account_id,'account-a');
  assert.equal(copy.require_follow,true);assert.equal(copy.followup_steps.length,2);
  assert.equal(f.db.tables.queue.length,0);assert.equal(f.db.tables.automation_runs.length,0);
});

test('API rejeita link inválido antes de gravar campanha',async()=>{
  const f=fixture();const route=f.rt.load('app/api/automations/route.ts');
  const body={...f.db.tables.automations[0],steps:[{type:'link',text:'Link',link_url:'javascript:alert(1)',link_label:'Abrir'}]};
  const res=await route.POST(new Request('https://app.test/api/automations',{method:'POST',body:JSON.stringify(body)}));
  assert.equal(res.status,400);assert.equal(f.db.tables.automations.length,1);
});

test('webhook exige assinatura e cron exige segredo configurado',async()=>{
  const f=fixture();const hook=f.rt.load('app/api/webhook/route.ts');const drain=f.rt.load('app/api/cron/drain/route.ts');
  assert.equal((await hook.POST(new Request('https://app.test/api/webhook',{method:'POST',body:'{}'}))).status,401);
  f.rt.env.CRON_SECRET='';
  assert.equal((await drain.POST(new Request('https://app.test/api/cron/drain',{method:'POST'}))).status,403);
});

for(const profile of [Response.json({error:{code:10}},{status:403}),'timeout']) {
  test(`Meta ${typeof profile==='string'?'indisponível':'sem permissão'} mantém link bloqueado`,async()=>{
    const f=fixture();await f.comment();await f.tick();f.setProfile(profile);
    await f.click();await f.tick();
    assert.equal(f.db.tables.queue.at(-1).payload.follower_state,'unavailable');
    assert.equal(f.db.tables.queue.filter(q=>q.payload.delivery_type==='link').length,0);
    assert.match(f.sent.at(-1).body.message.text,/permanece bloqueado/);
  });
}

test('falha ao enviar link não agenda follow-up',async()=>{
  const f=fixture();await f.comment();await f.tick();await f.click();await f.tick();
  f.setError('timeout');await f.tick();
  assert.equal(f.db.tables.queue.find(q=>q.kind==='flow_step'&&q.payload.step_index===1).status,'failed');
  assert.equal(f.db.tables.queue.filter(q=>q.kind==='sequence').length,0);
});

test('comentário já tratado pelo código anterior não reinicia execução',async()=>{
  const f=fixture();f.db.tables.queue.push({id:'legacy',account_id:'account-a',recipient_type:'comment_id',recipient_value:'comment-1',run_id:null,status:'sent'});
  await f.comment();assert.equal(f.db.tables.queue.length,1);assert.equal(f.db.tables.automation_runs.length,0);
});

test('campanha sem condição mantém avanço por clique e entrega normal',async()=>{
  const f=fixture();f.db.tables.automations[0].require_follow=false;
  await f.comment();await f.tick();await f.click();await f.tick();
  assert.equal(f.db.tables.queue.filter(q=>q.kind==='verify_follow').length,0);
  assert.equal(f.sent.length,2);assert.equal(f.db.tables.queue.filter(q=>q.kind==='sequence').length,1);
});
