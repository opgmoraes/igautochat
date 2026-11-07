// Somente inspeção local: serve as páginas reais com dados fictícios e auth simulada.
/* eslint-disable @typescript-eslint/no-require-imports */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const campaign = {id:'demo',account_id:'demo-account',name:'Guia de conteúdo',active:true,trigger_comment:true,keywords:['GUIA'],match_type:'contains',target_mode:'any',require_follow:true,steps:[{type:'message',text:'Oi! Siga nosso perfil para receber o guia e confirme no botão abaixo.',button_label:'Já segui ✅'},{type:'link',text:'Aqui está seu guia. Boa leitura!',link_url:'https://example.com/guia',link_label:'Acessar guia'}],followup_steps:[{text:'Conseguiu acessar? Aqui está mais um material.',delay_minutes:10,link_url:'https://example.com/material',link_label:'Ver material'},{text:'Quer conhecer nossa oferta?',delay_minutes:120}],metrics:{messages_sent:12,links_delivered:5,verifications:7,errors:1}};
http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  res.setHeader('Cache-Control','no-store');
  if(url.pathname==='/auth.js') {res.setHeader('Content-Type','text/javascript');return res.end("window.requireAuth=async()=>({access_token:'demo'});window.authFetch=fetch;");}
  if(url.pathname==='/mobile') {res.setHeader('Content-Type','text/html');return res.end('<!doctype html><meta charset="utf-8"><style>body{background:#ddd;margin:20px}iframe{border:0;width:390px;height:844px}</style><iframe title="Prévia móvel" src="/new-automation.html?id=demo"></iframe>');}
  if(url.pathname.startsWith('/api/')) {
    res.setHeader('Content-Type','application/json');
    const route=url.pathname;
    const data=route==='/api/accounts'?{accounts:[{id:'demo-account',ig_username:'conta_demo',label:'Demonstração'}]}:route==='/api/media'?{media:[]}:route==='/api/stats'?{sentWeek:12,failed24h:1,linksWeek:5,verificationsWeek:7}:route==='/api/events'?{items:[]}:route==='/api/automations'?{automations:[campaign]}:{automation:campaign};
    return res.end(JSON.stringify(data));
  }
  const file=path.resolve('public','.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(path.resolve('public')+path.sep)) {res.statusCode=403;return res.end();}
  try {res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}
}).listen(3101,'127.0.0.1',()=>console.log('UI preview http://127.0.0.1:3101/new-automation.html?id=demo'));
