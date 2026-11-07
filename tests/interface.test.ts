import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

for(const file of ['public/new-automation.html','public/dashboard.html']) {
  test(`JavaScript da página ${file} compila`,()=>{
    const html=fs.readFileSync(file,'utf8');
    for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script[1],{filename:file});
  });
}
test('prévia apresenta condição de seguidor, intervalos e conteúdo escapado',()=>{
  const html=fs.readFileSync('public/new-automation.html','utf8');
  const source=html.slice(html.indexOf('function updatePreview()'),html.indexOf('// ---------- alvo do post'));
  const elements:Record<string,{checked?:boolean;textContent?:string;innerHTML?:string}>={require_follow:{checked:true},'flow-summary':{},'phone-screen':{}};
  const context={document:{getElementById:(id:string)=>elements[id]},steps:[{type:'message',text:'Siga',button_label:'Confirmar'},{type:'link',text:'Guia',link_label:'Acessar'}],followups:[{text:'<script>teste</script>',delay_minutes:120}],escapeHtml:(text:string)=>String(text||'').replaceAll('<','&lt;')};
  vm.runInNewContext(source+';updatePreview()',context);
  assert.match(elements['flow-summary'].textContent!,/Verificar seguidor/);
  assert.match(elements['flow-summary'].textContent!,/Esperar 120 min/);
  assert.match(elements['phone-screen'].innerHTML!,/Já segui ✅/);
  assert.match(elements['phone-screen'].innerHTML!,/somente com janela aberta/);
  assert.ok(!elements['phone-screen'].innerHTML!.includes('<script>'));
});
