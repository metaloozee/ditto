// Independent round-two regressions; disposable SQLite and local injected platform classes only.
// node plans/004-repair-round-2-probes.cjs /absolute/candidate/root
const fs = require('node:fs');
const path = require('node:path');
let setup = fs.readFileSync(path.join(__dirname, '004-review-probes.cjs'), 'utf8').split('async function main() {')[0];
setup = setup.replace('const f = fixture(options); const id = await admit(f); await f.deliver(); return', "const f = fixture(options); f.seedTrustedExecutionEvidence(); const id = await admit(f); await f.deliver(); return");
const body = String.raw`
function commitInput(id, position=0) { return {expectedPosition:position,snapshot:{synthetic:true},runId:id,brainIncarnationId:'synthetic-brain-1',lifecycleGeneration:1,ownerVersion:1,runEpoch:1}; }
function payload(id, extra={}) { return {workspaceSessionId:'sess-1',userId:'user-1',projectId:'proj-1',ownerVersion:1,commandId:id,runId:id,...extra}; }
async function probe(name,fn) { try { const r=await fn();check(name,r.ok,r.observed); } catch(e){check(name,false,{harnessError:e?.name,code:e?.code??null});} }
async function main(){
  await probe('Q01 actual product-runtime-Container chain accepts, dedupes and observes without starts',async()=>{
    const f=fixture({now:()=>Date.now()});const id=await admit(f);const product=load(path.join(web,'src/lib/session-runtime-product.ts')); const server=load(path.join(runtime,'server.ts'));
    const productEntry=new product.ProductEntrypoint({}, {DB:d1Utils.createSqliteD1(f.sqlite)});const sqlite=new DatabaseSync(':memory:');const adapter=journal.createNodeSqliteAdapter(sqlite);let starts=0;
    const state={id:{toString:()=> 'synthetic-do'},blockConcurrencyWhile:async fn=>fn(),storage:{sql:{exec:(sql,...args)=>({toArray:()=>adapter.query(sql,...args)})},transactionSync:fn=>adapter.transaction(fn)}};
    const instance=new server.SessionRuntime(state,{PRODUCT:productEntry,RUNTIME_ENCRYPTION_CURRENT_KEY_VERSION:'v1',RUNTIME_ENCRYPTION_KEYS:JSON.stringify({v1:'07'.repeat(32)})});
    instance.start=instance.startAndWaitForPorts=instance.getTcpPort=()=>{starts++;throw new Error('Unexpected container start');};
    const routes=[];const entry=new server.RuntimeEntrypoint({}, {PRODUCT:productEntry,SessionRuntime:{getByName(name){routes.push(name);return instance;}}});
    const first=await entry.deliver({commandId:id,ownerVersion:1});const second=await entry.deliver({commandId:id,ownerVersion:1});const s=await entry.readSnapshot({sessionId:'sess-1'});
    const ok=first.commandId===id && second.receiptId===first.receiptId && s.runStates.length===1 && routes.every(r=>r==='sess-1') && starts===0;sqlite.close();
    return {ok,observed:{sameReceipt:first.receiptId===second.receiptId,runCount:s.runStates.length,startCalls:starts,correctRoutes:routes.every(r=>r==='sess-1')}};
  });
  await probe('Q02 command CAS cannot decrease persisted sequence with an older envelope',async()=>{
    const f=fixture();const id=await admit(f);const d1=d1Utils.createSqliteD1(f.sqlite);
    await projector.applyProductProjectionBatch(d1,[payload(id,{targetKind:'command',targetId:id,coordinatorSeq:10,expectedSourceStatus:'0'})],f.now());
    const r=await projector.applyProductProjectionBatch(d1,[payload(id,{targetKind:'command',targetId:id,coordinatorSeq:9,expectedSourceStatus:'10'})],f.now());
    const version=f.sqlite.prepare('SELECT executionProjectionVersion FROM session_commands WHERE id = ?').get(id).executionProjectionVersion;
    return {ok:version===10,observed:{targetVersion:version,classification:r[0].classification}};
  });
  await probe('Q03 wrong owner cannot poison cursor on a pending target',async()=>{
    const {f,id,c}=await ready();await c.reconcile();const assistant=f.observeReceipt(id).assistantMessageId;
    const r=await projector.applyProductProjectionBatch(d1Utils.createSqliteD1(f.sqlite),[payload(id,{targetKind:'message',targetId:assistant,coordinatorSeq:50,ownerVersion:99,status:'failed'})],f.now());
    const cursor=f.sqlite.prepare('SELECT runtimeOwnerVersion FROM runtime_projection_cursors WHERE targetId = ?').get(assistant);
    const status=f.sqlite.prepare('SELECT status FROM messages WHERE id = ?').get(assistant).status;
    return {ok:!cursor && status==='pending',observed:{cursorOwner:cursor?.runtimeOwnerVersion,status,classification:r[0].classification}};
  });
  await probe('Q04 rejected run membership cannot manufacture an already-applied cursor',async()=>{
    const {f,id,c}=await ready();await c.reconcile();const assistant=f.observeReceipt(id).assistantMessageId;
    const r=await projector.applyProductProjectionBatch(d1Utils.createSqliteD1(f.sqlite),[payload(id,{targetKind:'message',targetId:assistant,coordinatorSeq:50,runId:'wrong-run',status:'failed'})],f.now());
    const cursor=f.sqlite.prepare('SELECT coordinatorSeq FROM runtime_projection_cursors WHERE targetId = ?').get(assistant);
    return {ok:!cursor && r[0].classification==='blocked_membership',observed:{cursorSequence:cursor?.coordinatorSeq,classification:r[0].classification}};
  });
  await probe('Q05 D1 projection failure retains an independently scheduled retry',async()=>{
    const {f,id,c}=await ready();await c.reconcile();await stop(f,id);await f.deliver();
    c.adapters.applyProjections=async()=>{throw new Error('synthetic D1 unavailable');};f.scheduled.length=0;const r=await c.reconcile();
    const pending=c.sql.query("SELECT count(*) AS n FROM projections WHERE state = 'pending'")[0].n;
    return {ok:pending>0 && r.nextDeadlineAt!==null && f.scheduled.length>0,observed:{pending,nextDeadline:r.nextDeadlineAt,schedulerCalls:f.scheduled.length}};
  });
  await probe('Q06 bounded projection backlog schedules the next chunk',async()=>{
    const f=fixture();for(let i=0;i<18;i++)await admit(f,{idempotencyKey:'command-'+i});await f.deliver();const c=f.coordinator('sess-1');
    const rows=c.sql.query('SELECT payload_redacted FROM projections LIMIT 1');const p=JSON.parse(rows[0].payload_redacted);
    for(let i=0;i<35;i++)c.queueProjection({...p,targetId:p.targetId,coordinatorSeq:undefined});
    const r=await c.reconcile();const pending=c.sql.query("SELECT count(*) AS n FROM projections WHERE state = 'pending'")[0].n;
    return {ok:pending===0 || r.nextDeadlineAt!==null,observed:{pending,nextDeadline:r.nextDeadlineAt,processed:r.processed}};
  });
  await probe('Q07 a still-missing predecessor re-arms after the first gap retry fires',async()=>{
    let now=1700000000000;const f=fixture({now:()=>now});await admit(f);const id=await admit(f,{idempotencyKey:'gap'});const c=await f.ensureCoordinator({sessionId:'sess-1'});await c.acceptCommand({commandId:id,ownerVersion:1});
    const first=await c.reconcile();now=first.nextDeadlineAt;const next=await c.reconcile();
    return {ok:next.nextDeadlineAt!==null && next.nextDeadlineAt>now,observed:{stillAccepted:c.readSnapshot().commandStates[0].status,nextDeadline:next.nextDeadlineAt}};
  });
  await probe('Q08 a later activation revalidates previously checked command ciphertext',async()=>{
    const {f,id}=await ready({persistentJournal:true});await f.restartJournals();await f.coordinator('sess-1').ensureCanonicalRestore();
    f.coordinator('sess-1').sql.query("UPDATE commands SET ciphertext = 'tampered-after-previous-validation'");await f.restartJournals();
    const r=await attempt(()=>f.coordinator('sess-1').admitEffect(effect(f,id)));
    return {ok:!r.accepted,observed:{effectAdmitted:r.accepted}};
  });
  await probe('Q09 restore validates continuation 201 rather than silently truncating at 200',async()=>{
    const {f,id,c}=await ready({persistentJournal:true});for(let i=0;i<201;i++)await c.commitContinuation(commitInput(id,i));
    c.sql.query("UPDATE continuations SET ciphertext = 'tampered-tail' WHERE position = 201");await f.restartJournals();
    const r=await attempt(()=>f.coordinator('sess-1').admitEffect(effect(f,id)));
    return {ok:!r.accepted,observed:{effectAdmitted:r.accepted}};
  });
  await probe('Q10 exhausted restore budget cannot mark an unchecked suffix safe',async()=>{
    const f=fixture({persistentJournal:true});const c=await f.ensureCoordinator({sessionId:'sess-1'});let last;
    for(let i=0;i<26;i++){last=await admit(f,{idempotencyKey:'restore-'+i});await c.acceptCommand({commandId:last,ownerVersion:1});}
    c.sql.query("UPDATE commands SET ciphertext = 'tampered-unchecked-suffix' WHERE command_id = ?",last);await f.restartJournals();const restored=f.coordinator('sess-1');let tick=0;restored.clock.now=()=>1700000000000+6000*(tick++);
    const r=await attempt(()=>restored.ensureCanonicalRestore());
    return {ok:!r.accepted || restored.canonicalRestore!=='ok',observed:{returnedSuccess:r.accepted,restoreState:restored.canonicalRestore}};
  });
  await probe('Q11 positive control: canonical read rejects a different brain incarnation',async()=>{
    const {id,c}=await ready();await c.commitContinuation(commitInput(id));
    const r=await attempt(()=>c.readCanonicalContinuation(1,{brainIncarnationId:'different-brain',runId:id,lifecycleGeneration:1}));
    return {ok:!r.accepted,observed:{foreignBrainReadAccepted:r.accepted}};
  });
  await probe('Q12 exact current brain pointer controls continuation authority',async()=>{
    const {f,id,c}=await ready();const columns=f.sqlite.prepare('PRAGMA table_info(workspace_sessions)').all().map(r=>r.name);
    if(!columns.includes('brainIdentityId'))f.sqlite.exec('ALTER TABLE workspace_sessions ADD COLUMN brainIdentityId text');
    f.sqlite.exec("UPDATE workspace_sessions SET brainIdentityId = 'different-current-brain'");
    const r=await attempt(()=>c.commitContinuation(commitInput(id)));
    return {ok:!r.accepted,observed:{staleBrainCommitAccepted:r.accepted}};
  });
  await probe('Q13 failed command acceptance durability blocks later effects in an existing run',async()=>{
    const {f,id,c}=await ready();const next=await admit(f,{idempotencyKey:'new-command'});const query=c.sql.query.bind(c.sql);let hit=false;
    c.sql.query=(sql,...args)=>{if(!hit && /INSERT INTO commands/.test(sql)){hit=true;throw new Error('synthetic command write failure');}return query(sql,...args);};
    const failed=await attempt(()=>c.acceptCommand({commandId:next,ownerVersion:1}));const r=await attempt(()=>c.admitEffect(effect(f,id)));
    return {ok:hit && !failed.accepted && !r.accepted,observed:{faultHit:hit,acceptSucceeded:failed.accepted,nextEffectAdmitted:r.accepted}};
  });
  await probe('Q14 consumption does not start archived queued commands',async()=>{
    const f=fixture();const first=await admit(f);const second=await admit(f,{idempotencyKey:'later'});const c=await f.ensureCoordinator({sessionId:'sess-1'});await c.acceptCommand({commandId:second,ownerVersion:1});
    f.sqlite.exec("UPDATE workspace_sessions SET status = 'archived'");await attempt(()=>c.acceptCommand({commandId:first,ownerVersion:1}));
    const queued=c.readSnapshot().runStates.filter(r=>['queued','starting','running'].includes(r.status)).length;
    return {ok:queued===0,observed:{newQueuedRuns:queued}};
  });
  for(const f of allFixtures){f.dispose();f.sqlite.close();}
  const failures=results.filter(r=>r.result==='FAIL').length;console.log(JSON.stringify({checks:results.length,failures}));process.exitCode=failures?1:0;
}
main().catch(e=>{console.error(JSON.stringify({harnessError:e?.name,code:e?.code??null}));process.exitCode=2;});
`;
new Function('require','process',setup+body)(require,process);
