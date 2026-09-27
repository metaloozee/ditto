// Independent second-round checks. Local candidate modules and disposable SQLite only.
// Run: node plans/004-repair-extra-probes.cjs /absolute/candidate/root
const fs = require('node:fs');
const path = require('node:path');
let setup = fs.readFileSync(path.join(__dirname, '004-review-probes.cjs'), 'utf8').split('async function main() {')[0];
setup = setup.replace('const f = fixture(options); const id = await admit(f); await f.deliver(); return', "const f = fixture(options); f.seedExecutorIdentity({ incarnationId: 'synthetic-exec-1' }); const id = await admit(f); await f.deliver(); return");
const body = String.raw`
async function probe(name, fn) {
  try { const result = await fn(); check(name, result.ok, result.observed); }
  catch (error) { check(name, false, { harnessError: error?.name, code: error?.code ?? null }); }
}
function base(id, f, extra = {}) {
  return { workspaceSessionId: 'sess-1', userId: 'user-1', projectId: 'proj-1', ownerVersion: 1, commandId: id, runId: id, ...extra };
}
async function main() {
  await probe('P01 real ProductEntrypoint reconstructs an admitted persisted command', async () => {
    const f = fixture(); const id = await admit(f); const server = load(path.join(runtime, 'server.ts'));
    const entry = new server.ProductEntrypoint({}, { DB: d1Utils.createSqliteD1(f.sqlite) });
    const result = await entry.reconstructCommand(id);
    return { ok: result?.command?.commandId === id, observed: { reconstructed: result !== null } };
  });
  await probe('P02 positive control: current fixture reaches effect and identical result dedupe', async () => {
    const {f,id,c} = await ready(); const e = effect(f,id); const first = await c.admitEffect(e);
    const one = await c.recordEffectResult({...e,result:{synthetic:true}}); const two = await c.recordEffectResult({...e,result:{synthetic:true}});
    return {ok:first.state === 'admitted' && one.state === 'result_recorded' && two.state === 'result_recorded',observed:{admission:first.state,first:one.state,duplicate:two.state}};
  });
  await probe('P03 legacy lease alone does not replace brain capacity and initial-pair prerequisites', async () => {
    const {f,id,c} = await ready(); const r = await attempt(() => c.admitEffect(effect(f,id)));
    return {ok:!r.accepted,observed:{admitted:r.accepted}};
  });
  for (const kind of ['project_seed','trusted_brain']) await probe('P04 execution rejects identity role '+kind, async () => {
    const {f,id,c} = await ready(); f.sqlite.prepare('UPDATE sandbox_identities SET kind = ?').run(kind);
    const r = await attempt(() => c.admitEffect(effect(f,id))); return {ok:!r.accepted,observed:{admitted:r.accepted}};
  });
  await probe('P05 identity lease must match exact execution identity', async () => {
    const {f,id,c} = await ready(); f.sqlite.exec("UPDATE workspace_capacity_leases SET identityId = 'unrelated-identity'");
    const r = await attempt(() => c.admitEffect(effect(f,id))); return {ok:!r.accepted,observed:{admitted:r.accepted}};
  });
  await probe('P06 different tools serialize across one workspace', async () => {
    const {f,id,c} = await ready(); await c.admitEffect(effect(f,id)); const r = await attempt(() => c.admitEffect(effect(f,id,{toolCallId:'second-tool'})));
    return {ok:!r.accepted,observed:{secondAdmitted:r.accepted}};
  });
  await probe('P07 unknown effect blocks a distinct replacement run too', async () => {
    const {f,id,c} = await ready(); const e = effect(f,id); await c.admitEffect(e); c.markOutcomeUnknown(e);
    const next = await admit(f,{idempotencyKey:'replacement'}); await f.deliver();
    const r = await attempt(() => c.admitEffect(effect(f,next,{runEpoch:1})));
    return {ok:!r.accepted,observed:{replacementAdmitted:r.accepted,oldEffectState:c.sql.query('SELECT state FROM effects WHERE run_id = ?',id)[0].state}};
  });
  await probe('P08 unrelated isolation reference never authorizes a replacement writer', async () => {
    const {f,id,c} = await ready(); await c.admitEffect(effect(f,id)); await stop(f,id); await f.deliver();
    c.sql.query("UPDATE process_observations SET isolation_evidence_ref = 'unrelated-evidence'");
    const next = await admit(f,{idempotencyKey:'replacement'}); await f.deliver();
    const r = await attempt(() => c.admitEffect(effect(f,next,{runEpoch:1})));
    return {ok:!r.accepted,observed:{replacementAdmitted:r.accepted,oldRunState:c.readSnapshot().runStates.find(r=>r.id===id)?.status}};
  });
  await probe('P09 actual effect INSERT failure latches every subsequent effect', async () => {
    const {f,id,c} = await ready(); const query = c.sql.query.bind(c.sql); let hit = false;
    c.sql.query = (sql,...args) => { if (!hit && /INSERT INTO effects/.test(sql)) { hit = true; throw new Error('synthetic effect persistence failure'); } return query(sql,...args); };
    const first = await attempt(() => c.admitEffect(effect(f,id))); const next = await attempt(() => c.admitEffect(effect(f,id,{toolCallId:'after-failure'})));
    return {ok:hit && !first.accepted && !next.accepted,observed:{faultHit:hit,firstAdmitted:first.accepted,nextAdmitted:next.accepted}};
  });
  await probe('P10 effect assistant identity must belong to its exact run', async () => {
    const {f,id,c} = await ready(); const b = await admit(f,{idempotencyKey:'other-run'}); await f.deliver();
    const r = await attempt(() => c.admitEffect(effect(f,id,{assistantEntryId:f.observeReceipt(b).assistantMessageId})));
    return {ok:!r.accepted,observed:{foreignRunAssistantAccepted:r.accepted}};
  });
  await probe('P11 stopped A cannot write a continuation by implicitly borrowing queued B', async () => {
    const {f,id,c} = await ready(); await stop(f,id); await f.deliver(); await admit(f,{idempotencyKey:'later-run'}); await f.deliver();
    const r = await attempt(() => c.commitContinuation({expectedPosition:0,snapshot:{syntheticOldRun:id}}));
    return {ok:!r.accepted,observed:{staleCommitAccepted:r.accepted}};
  });
  await probe('P12 continuation checks the latest authority after encryption', async () => {
    const {f,c} = await ready(); const read = c.adapters.readCurrentAuthority; let calls = 0;
    c.adapters.readCurrentAuthority = async (input) => { calls++; if (calls===2) f.sqlite.exec('UPDATE workspace_sessions SET runtimeOwnerVersion = 3'); return read(input); };
    const r = await attempt(() => c.commitContinuation({expectedPosition:0,snapshot:{synthetic:true}}));
    return {ok:!r.accepted,observed:{reads:calls,staleCommitAccepted:r.accepted}};
  });
  await probe('P13 revoked authority cannot obtain decrypted canonical continuation', async () => {
    const {f,c} = await ready(); await c.commitContinuation({expectedPosition:0,snapshot:{synthetic:true}});
    f.sqlite.exec("UPDATE projects SET status = 'deleting'"); const r = await attempt(() => c.readCanonicalContinuation(1));
    return {ok:!r.accepted,observed:{plaintextReturned:r.accepted}};
  });
  await probe('P14 positive control: inline continuation round-trips', async () => {
    const {c} = await ready(); await c.commitContinuation({expectedPosition:0,snapshot:{synthetic:true}}); const r = await c.readCanonicalContinuation(1);
    return {ok:r.synthetic===true,observed:{roundTrip:r.synthetic===true}};
  });
  await probe('P15 large committed continuation round-trips and survives restart', async () => {
    const {f,c} = await ready({persistentJournal:true}); const payload = {synthetic:'x'.repeat(40000)};
    await c.commitContinuation({expectedPosition:0,snapshot:payload}); await f.restartJournals();
    const r = await attempt(() => f.coordinator('sess-1').readCanonicalContinuation(1));
    return {ok:r.accepted && r.value.synthetic===payload.synthetic,observed:{readable:r.accepted,category:r.code}};
  });
  await probe('P16 corrupt retained large chunks block admission after restart', async () => {
    const {f,id,c} = await ready({persistentJournal:true}); await c.commitContinuation({expectedPosition:0,snapshot:{synthetic:'x'.repeat(40000)}});
    c.sql.query("UPDATE large_record_chunks SET ciphertext = 'corrupted-chunk'"); await f.restartJournals();
    const r = await attempt(() => f.coordinator('sess-1').admitEffect(effect(f,id)));
    return {ok:!r.accepted,observed:{effectAdmitted:r.accepted}};
  });
  await probe('P17 corrupt retained effect result blocks admission after restart', async () => {
    const {f,id,c} = await ready({persistentJournal:true}); const e = effect(f,id); await c.admitEffect(e); await c.recordEffectResult({...e,result:{synthetic:true}});
    c.sql.query("UPDATE effects SET result_ciphertext = 'corrupted-result'"); await f.restartJournals();
    const r = await attempt(() => f.coordinator('sess-1').admitEffect(effect(f,id,{toolCallId:'after-corruption'})));
    return {ok:!r.accepted,observed:{effectAdmitted:r.accepted}};
  });
  await probe('P18 repeated identical command projection is acknowledged idempotently', async () => {
    const f = fixture(); const id = await admit(f); const p = base(id,f,{targetKind:'command',targetId:id,coordinatorSeq:9,expectedSourceStatus:'0'}); const d1=d1Utils.createSqliteD1(f.sqlite);
    const first=await projector.applyProductProjectionBatch(d1,[p],f.now()); const second=await projector.applyProductProjectionBatch(d1,[p],f.now());
    return {ok:first[0].classification==='applied' && second[0].classification==='already_applied',observed:{first:first[0].classification,duplicate:second[0].classification}};
  });
  await probe('P19 real command membership cannot be reassigned to a different run', async () => {
    const f=fixture(); const a=await admit(f); const b=await admit(f,{idempotencyKey:'b'}); const receipt=f.observeReceipt(b);
    const row=f.sqlite.prepare('SELECT userMessageId, assistantMessageId FROM session_commands WHERE id = ?').get(b);
    const p=base(b,f,{targetKind:'membership',targetId:b,runId:a,coordinatorSeq:1,userMessageId:row.userMessageId,assistantMessageId:row.assistantMessageId}); const d1=d1Utils.createSqliteD1(f.sqlite);
    const result=await projector.applyProductProjectionBatch(d1,[p,{...p,targetKind:'message',targetId:receipt.assistantMessageId,coordinatorSeq:2,status:'failed'}],f.now());
    const status=f.sqlite.prepare('SELECT status FROM messages WHERE id = ?').get(receipt.assistantMessageId).status;
    return {ok:status==='pending',observed:{unrelatedAssistantStatus:status,classifications:result.map(r=>r.classification)}};
  });
  await probe('P20 unauthorized envelope cannot advance cursor of an already-terminal target', async () => {
    const {f,id,c}=await ready(); await c.reconcile(); const assistant=f.observeReceipt(id).assistantMessageId; const d1=d1Utils.createSqliteD1(f.sqlite);
    const p=base(id,f,{targetKind:'message',targetId:assistant,coordinatorSeq:10,status:'failed'}); await projector.applyProductProjectionBatch(d1,[p],f.now());
    const result=await projector.applyProductProjectionBatch(d1,[{...p,ownerVersion:99,coordinatorSeq:999}],f.now());
    const cursor=f.sqlite.prepare('SELECT runtimeOwnerVersion, coordinatorSeq FROM runtime_projection_cursors WHERE targetId = ?').get(assistant);
    return {ok:cursor.runtimeOwnerVersion===1 && cursor.coordinatorSeq===10,observed:{cursorOwner:cursor.runtimeOwnerVersion,cursorSequence:cursor.coordinatorSeq,classification:result[0].classification}};
  });
  await probe('P21 declared session projection is not silently acknowledged without target logic', async () => {
    const f=fixture(); const result=await projector.applyProductProjectionBatch(d1Utils.createSqliteD1(f.sqlite),[base(null,f,{targetKind:'session',targetId:'sess-1',coordinatorSeq:1,status:'recovery_pending',expectedSourceStatus:'healthy'})],f.now());
    return {ok:result[0].classification!=='already_applied',observed:{classification:result[0].classification}};
  });
  await probe('P22 positive control: successful final content projection is non-vacuous', async () => {
    const {f,id,c}=await ready(); await c.reconcile(); const assistant=f.observeReceipt(id).assistantMessageId;
    const result=await projector.applyProductProjectionBatch(d1Utils.createSqliteD1(f.sqlite),[base(id,f,{targetKind:'message',targetId:assistant,coordinatorSeq:10,status:'complete',contentRedacted:'synthetic final result'})],f.now());
    const row=f.sqlite.prepare('SELECT status, content FROM messages WHERE id = ?').get(assistant);
    return {ok:row.status==='complete' && row.content==='synthetic final result',observed:{status:row.status,contentBytes:Buffer.byteLength(row.content),classification:result[0].classification}};
  });
  await probe('P23 interruption itself schedules the persisted recovery deadline', async () => {
    const {f,id,c}=await ready(); for(let i=0;i<3;i++) await c.reconcile(); f.scheduled.length=0;
    const deadline=c.recordInterruption(id);
    return {ok:f.scheduled.some(s=>+s.when===deadline.recoveryDeadlineAt),observed:{schedulerCalls:f.scheduled.length}};
  });
  await probe('P24 expired admitted effect is reconciled rather than scheduled forever in the past', async () => {
    let now=1700000000000; const {f,id,c}=await ready({now:()=>now}); await c.admitEffect(effect(f,id)); now+=61000;
    const result=await c.reconcile(); const state=c.sql.query('SELECT state FROM effects WHERE run_id = ?',id)[0].state;
    return {ok:state!=='admitted' && (result.nextDeadlineAt===null || result.nextDeadlineAt>now),observed:{state,nextInPast:result.nextDeadlineAt!==null && result.nextDeadlineAt<now}};
  });
  await probe('P25 missing predecessor uses future backoff, not immediate reschedule', async () => {
    const f=fixture(); await admit(f); const id=await admit(f,{idempotencyKey:'gap'}); const c=await f.ensureCoordinator({sessionId:'sess-1'});
    await c.acceptCommand({commandId:id,ownerVersion:1}); const result=await c.reconcile();
    return {ok:result.nextDeadlineAt>f.now(),observed:{nextDeadlineDelta:result.nextDeadlineAt-f.now()}};
  });
  await probe('P26 snapshot settles follow-up assistants consistently with D1', async () => {
    const {f,id,c}=await ready(); const follow=await f.asUser('user-1').command({version:1,kind:'follow_up',projectId:'proj-1',sessionId:'sess-1',idempotencyKey:'follow',targetRunId:id,text:'synthetic follow-up'});
    await f.deliver(); await stop(f,id); await f.deliver(); for(let i=0;i<3;i++) await c.reconcile();
    const assistant=f.observeReceipt(follow.body.commandId).assistantMessageId; const snapshot=await observe(f); const state=snapshot.messageStates.find(r=>r.id===assistant)?.status;
    const db=f.sqlite.prepare('SELECT status FROM messages WHERE id = ?').get(assistant).status;
    return {ok:state==='failed' && db==='failed',observed:{snapshotStatus:state,d1Status:db}};
  });
  await probe('P27 active effect result after Stop eventually completes stopping reconciliation', async () => {
    const {f,id,c}=await ready(); const e=effect(f,id); await c.admitEffect(e); await stop(f,id); await f.deliver(); await c.recordEffectResult({...e,result:{synthetic:true}});
    for(let i=0;i<3;i++) await c.reconcile(); const state=c.readSnapshot().runStates.find(r=>r.id===id)?.status;
    // A returned result alone need not prove quiescence, so this probe only requires durable future reconciliation.
    const pending=c.sql.query("SELECT count(*) AS n FROM wakeups WHERE state = 'pending'")[0].n;
    const next=journal.nextWorkDeadline(c.sql,f.now());
    return {ok:state!=='stopping' || pending>0 || next!==null,observed:{runState:state,pendingWakeups:pending,hasNext:next!==null}};
  });
  for(const f of allFixtures){f.dispose();f.sqlite.close();}
  const failed=results.filter(r=>r.result==='FAIL').length; console.log(JSON.stringify({checks:results.length,failures:failed})); process.exitCode=failed?1:0;
}
main().catch(error=>{console.error(JSON.stringify({harnessError:error?.name,code:error?.code??null}));process.exitCode=2;});
`;
new Function('require', 'process', setup + body)(require, process);
