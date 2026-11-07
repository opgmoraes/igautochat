/* eslint-disable @typescript-eslint/no-explicit-any */
// Executa os handlers reais com Supabase em memória e transporte Meta controlado.
import ts from 'typescript';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const nativeRequire = createRequire(import.meta.url);

export class MemoryDB {
  tables: Record<string, any[]> = {accounts:[],automations:[],contacts:[],queue:[],automation_runs:[],events:[]};
  from(name:string) { return new Query(this,name); }
  async rpc(name:string,p:any) {
    if (name !== 'record_instagram_interaction') throw new Error(name);
    let contact = this.tables.contacts.find(c=>c.account_id===p.p_account && c.ig_scoped_id===p.p_sender);
    if (!contact) { contact={id:randomUUID(),account_id:p.p_account,ig_scoped_id:p.p_sender};this.tables.contacts.push(contact); }
    if (!contact.last_reply_at || contact.last_reply_at < p.p_at) contact.last_reply_at=p.p_at;
    return {data:[{...contact}],error:null};
  }
}
class Query implements PromiseLike<any> {
  filters: ((r:any)=>boolean)[]=[]; op='read'; values:any; returning=false; mode='many'; limitN=Infinity; orderField=''; ascending=true; options:any;
  private db:MemoryDB;
  private table:string;
  constructor(db:MemoryDB,table:string) {this.db=db;this.table=table;}
  select(fields?:string) { void fields;this.returning=true;return this; }
  insert(v:any) {this.op='insert';this.values=v;return this;}
  upsert(v:any,o:any) {this.op='upsert';this.values=v;this.options=o;return this;}
  update(v:any) {this.op='update';this.values=v;return this;}
  eq(k:string,v:any) {this.filters.push(r=>k==='automations.active' ? this.db.tables.automations.find(a=>a.id===r.automation_id)?.active===v : r[k]===v);return this;}
  lt(k:string,v:any) {this.filters.push(r=>r[k]!=null && r[k]<v);return this;}
  lte(k:string,v:any) {this.filters.push(r=>r[k]<=v);return this;}
  is(k:string,v:any) {this.filters.push(r=>(r[k]??null)===v);return this;}
  not(k:string,_op:string,v:any) {this.filters.push(r=>(r[k]??null)!==v);return this;}
  contains(k:string,v:any) {this.filters.push(r=>Object.keys(v).every(key=>r[k]?.[key]===v[key]));return this;}
  order(k:string,o?:any) {this.orderField=k;this.ascending=o?.ascending!==false;return this;}
  limit(n:number) {this.limitN=n;return this;}
  single() {this.mode='single';return this;}
  maybeSingle() {this.mode='maybe';return this;}
  then<TResult1 = any,TResult2 = never>(resolve?:((value:any)=>TResult1|PromiseLike<TResult1>)|null,reject?:((reason:any)=>TResult2|PromiseLike<TResult2>)|null):Promise<TResult1|TResult2> {return Promise.resolve(this.execute()).then(resolve,reject);}
  execute() {
    const table=this.db.tables[this.table];
    let rows=table.filter(r=>this.filters.every(f=>f(r)));
    if(this.op==='insert'||this.op==='upsert') {
      const keys=this.options?.onConflict?.split(',') || [this.table==='queue'?'dedup_key':'trigger_key'];
      const existing=table.find(r=>keys.every((k:string)=>this.values[k]!==undefined && r[k]===this.values[k]));
      if(existing) {
        if(this.op==='insert') return {error:{code:'23505'},data:null};
        if(this.options?.ignoreDuplicates) rows=[];
        else {Object.assign(existing,this.values);rows=[existing];}
      } else {
        const row={id:randomUUID(),created_at:new Date().toISOString(),...(this.table==='queue'?{status:'pending',send_after:new Date().toISOString(),attempts:0}:{}),...JSON.parse(JSON.stringify(this.values))};
        table.push(row);rows=[row];
      }
    } else if(this.op==='update') { for(const r of rows) Object.assign(r,this.values); }
    if(this.orderField) rows.sort((a,b)=>String(a[this.orderField]).localeCompare(String(b[this.orderField]))*(this.ascending?1:-1));
    rows=rows.slice(0,this.limitN);
    const data=rows.map(r=>({...r,contacts:this.db.tables.contacts.find(c=>c.id===r.contact_id),accounts:this.db.tables.accounts.find(c=>c.id===r.account_id),automation_runs:this.db.tables.automation_runs.find(c=>c.id===r.run_id)}));
    return {data:this.mode==='many'?data:data[0]||null,error:this.mode==='single'&&!data.length?{code:'missing'}:null};
  }
}

export function runtime(db:MemoryDB, fetcher:typeof fetch) {
  const cache=new Map<string,any>();
  const env={IG_APP_SECRET:'test-app-secret',WEBHOOK_VERIFY_TOKEN:'test-verify',CRON_SECRET:'test-cron'};
  function load(filename:string):any {
    filename=path.resolve(filename);
    if(cache.has(filename))return cache.get(filename);
    const loadedModule={exports:{} as any};cache.set(filename,loadedModule.exports);
    const output=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    const customRequire=(name:string) => {
      if(name==='next/server')return {NextResponse:Response,after:()=>{}};
      if(name==='@/lib/supabase')return {supabaseAdmin:()=>db};
      if(name==='@/lib/authGuard')return {requireUser:async()=>({id:'admin'})};
      if(name.startsWith('@/'))return load(name.slice(2)+'.ts');
      if(name.startsWith('.'))return load(path.resolve(path.dirname(filename),name.replace(/\.ts$/,'')+'.ts'));
      return nativeRequire(name);
    };
    vm.runInNewContext(`(function(require,module,exports){${output}\n})`,{Response,Request,Headers,URL,URLSearchParams,AbortSignal,Buffer,fetch:fetcher,process:{env},console,setTimeout:(f:()=>void)=>{f();return 0;}})(customRequire,loadedModule,loadedModule.exports);
    cache.set(filename,loadedModule.exports);return loadedModule.exports;
  }
  return {load,env};
}
