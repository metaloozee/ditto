node --no-warnings <<'NODE'
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const root='/home/ayan/ditto-worktrees/plan-005-codex/';
const read=p=>fs.readFileSync(root+p,'utf8');
const contract=stripTypeScriptTypes(read('apps/runtime/src/startup-contract.ts')).replaceAll('export ','');
const service=stripTypeScriptTypes(read('apps/web/src/lib/runtime-startup-service.ts')).replace(/import[\s\S]*?from\s+"[^"]+";/g,'').replaceAll('export ','');
const constants=read('apps/web/src/lib/workspace-runtime-capacity.ts').match(/export const WORKSPACE_CAPACITY_(?:GLOBAL|PER_USER)_LIMIT = \d+;/g).join('\n').replaceAll('export ','');
const createService=vm.runInNewContext(contract+'\n'+constants+'\n'+service+'\ncreateRuntimeStartupService',{crypto:globalThis.crypto,Date});
const ownership=read('apps/web/src/lib/sqlite-d1-test-utils.ts').match(/export const OWNERSHIP_D1_SCHEMA = `([\s\S]*?)`;/)[1];
const schema=read('apps/web/src/test/session-runtime-fixture.ts').match(/export const SESSION_COMMAND_D1_SCHEMA = `([\s\S]*?)`;/)[1].replace('${OWNERSHIP_D1_SCHEMA}',ownership);
function setup(){
 const sql=new DatabaseSync(':memory:'); sql.exec(schema);
 sql.exec(`CREATE TABLE project_seeds (id text PRIMARY KEY,projectId text,buildState text,startupRoles text,startupPools text,expectedRuntimeOwnerVersion integer,expectedIdentityId text,startupDeadline integer); CREATE TABLE privileged_operations (id text PRIMARY KEY,identityId text,closedAt integer,closeReason text,openSlot text);`);
 const prior=read('apps/web/migrations/0020_trusted_runtime_additive.sql');
 for(const table of ['runtime_capacity_reservations','runtime_migrations']) sql.exec(prior.split('--> statement-breakpoint').find(s=>s.trimStart().startsWith('CREATE TABLE `'+table+'`')));
 sql.exec(`CREATE UNIQUE INDEX runtime_capacity_reservations_identity_pool_active_uidx ON runtime_capacity_reservations(identityId,pool,activeSlot)`);
 for(const file of ['0021_runtime_execution_admissions.sql','0022_runtime_startup_assignments.sql'])sql.exec(read('apps/web/migrations/'+file).replaceAll('--> statement-breakpoint',''));
 sql.exec(`INSERT INTO projects (id,userId) VALUES ('p','u'); INSERT INTO workspace_sessions (id,projectId,userId,runtimeOwner) VALUES ('s','p','u','trusted_v1'); INSERT INTO session_commands (id,userId,targetKind,targetId,projectId,sessionId,kind,commandSeq,payloadVersion,userMessageId,assistantMessageId,payloadDigest,acceptedAt,deadlineAt) VALUES ('c','u','workspace_session','s','p','s','prompt',1,1,'um','am','digest',0,9999999999999); INSERT INTO workspace_runtime_work (id,fifoSeq,sessionId,projectId,userId,intent,queueExpiresAt,runtimeOwner,commandId,startupRoles,startupPools,startupDeadline) VALUES ('w',1,'s','p','u','agent_run',9999999999,'trusted_v1','c','["trusted_brain","workspace_session"]','["brain","execution"]',9999999999999); UPDATE runtime_capacity_policy SET accountingMode='unified';`);
 function prepare(text,params=[]){return {text,params,bind(...params){return prepare(text,params)},async first(){return sql.prepare(text).all(...params)[0]??null},async all(){return {results:sql.prepare(text).all(...params)}},async run(){return sql.prepare(text).run(...params)}}}
 const db={prepare,async batch(statements){sql.exec('BEGIN');try{for(const x of statements)sql.prepare(x.text).all(...x.params);sql.exec('COMMIT')}catch(e){sql.exec('ROLLBACK');throw e}}};
 const runtime={async startupRouting(a){return {containerId:a.role+':'+a.routingName,controllerClass:a.role==='trusted_brain'?'SessionRuntime':'Sandbox',controllerNamespace:'runtime'}},async observeStartup(a){return {...a,state:'terminated'}}};
 const api=createService({db,namespace:'runtime',runtime}); const ref={sourceKind:'command',sourceId:'w'};
 return {sql,api,ref};
}
async function pair(s){
 const brain=await s.api.register({...s.ref,role:'trusted_brain'});
 await s.api.register({...s.ref,role:'workspace_session'});
 const reservations=await s.api.reserve(s.ref);
 return reservations.find(r=>r.identityId===brain.identityId);
}
async function denied(action){try{await action();return false}catch{return true}}
let failures=0;
function report(name,ok){console.log(JSON.stringify({name,result:ok?'PASS':'FAIL'}));if(!ok)failures++}
(async()=>{
 let s=setup();
 s.sql.exec("UPDATE workspace_runtime_work SET expectedIdentityId='explicitly-different-target'");
 const rejected=await denied(()=>s.api.register({...s.ref,role:'trusted_brain'}));
 report('S01 explicit expected brain cannot authorize a different identity',rejected&&s.sql.prepare('SELECT count(*) AS n FROM sandbox_identities').get().n===0);
 s.sql.close();
 s=setup();let r=await pair(s);
 report('S00 valid paired startup reserves both roles',s.sql.prepare('SELECT count(*) AS n FROM runtime_capacity_reservations').get().n===2);
 s.sql.prepare("UPDATE runtime_capacity_reservations SET ownerKind='builder' WHERE id=?").run(r.reservationId);
 report('S02 reserve denies incompatible reservation ownerKind',await denied(()=>s.api.reserve(s.ref)));
 s.sql.close();
 s=setup();r=await pair(s);
 s.sql.prepare("UPDATE runtime_capacity_reservations SET ownerId='foreign-session' WHERE id=?").run(r.reservationId);
 report('S03 release denies foreign reservation ownerId',await denied(()=>s.api.release(r))&&s.sql.prepare('SELECT observedState FROM runtime_capacity_reservations WHERE id=?').get(r.reservationId).observedState==='reserved');
 s.sql.close();
 s=setup();r=await pair(s);await s.api.release(r);
 s.sql.prepare("UPDATE runtime_capacity_reservations SET ownerId='foreign-session' WHERE id=?").run(r.reservationId);
 report('S04 released retry rechecks reservation target owner',await denied(()=>s.api.release(r)));
 s.sql.close();
 process.exitCode=failures?1:0;
})().catch(()=>{console.error('Probe execution error');process.exitCode=2});
NODE
