import { env, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { parseCommandV2, type CommandV2 } from "../../../../../packages/runtime-contracts/src/product-command.ts";
import { PiDurableHost, type HostFixtureDependencies } from "../../../../../apps/runtime/src/pi-durable-host.ts";
import { cooperativeFixture } from "../../../../../apps/runtime/src/pi-durable-cooperative-fixture.ts";
import { importRuntimeKeyringFromBytes } from "../../../../../apps/runtime/src/runtime-crypto.ts";

function prompt(now: number): CommandV2 {
	return parseCommandV2({version:2,kind:"prompt",commandId:"prompt",commandSeq:1,userId:"owner",projectId:"project",workspaceSessionId:"workspace",runtimeOwnerVersion:1,receiptId:"prompt-receipt",acceptedAt:now,deadlineAt:now+900000,payloadDigest:"a".repeat(64),userMessageId:"user",assistantMessageId:"assistant",text:"Synthetic advisor instruction"});
}
function control(now: number, kind: "stop" | "cancel"): CommandV2 {
	return parseCommandV2({version:2,kind,commandId:kind,commandSeq:2,userId:"owner",projectId:"project",workspaceSessionId:"workspace",runtimeOwnerVersion:1,receiptId:`${kind}-receipt`,acceptedAt:now,deadlineAt:now+900000,payloadDigest:"b".repeat(64),...(kind==="stop"?{targetRunId:"prompt"}:{targetCommandId:"prompt"})});
}
async function probe(name: string, run: (host: PiDurableHost, storage: DurableObjectStorage, state: {now:number, crossStart:boolean, held:boolean, entered:boolean, release:()=>void})=>Promise<void>) {
	await runInDurableObject(env.PI_HOST_STORAGE.getByName(name),async (_instance,ctx)=>{
		let release=()=>{};
		const held=new Promise<void>(resolve=>{release=resolve;});
		const state={now:Date.now()+60000,crossStart:false,held:false,entered:false,release};
		const keyring=await importRuntimeKeyringFromBytes("v1",{v1:new Uint8Array(32).fill(1)});
		const dependencies: HostFixtureDependencies={
			now:()=>state.now,
			retained:{ownerId:"owner",workspaceSessionId:"workspace",keyring},
			authority:async()=>({current:true,generation:1,executor:1,liveExecutors:1}),
			fault:(point)=>{if(state.crossStart&&point==="intent"){state.crossStart=false;state.now+=900001;}},
			candidate:{userId:"owner",projectId:"project",workspaceSessionId:"workspace",ownerVersion:1,
				reconcileDecision:async()=>{state.entered=true;if(state.held)await held;return true;},
				configuration:async()=>({subject:{version:1,userId:"owner",projectId:"project",workspaceSessionId:"workspace",identityId:"executor",incarnationId:"incarnation",controllerNamespace:"fixture-pi-durable-execution-v1",lifecycleGeneration:1,runtimeOwnerVersion:1,connectionGeneration:1,capabilityRevision:1},defaultSelection:{model:"faux-1",thinking:"off"},authorize:async()=>({version:1,status:"denied"})}),
			},
			options:(guard)=>{const f=cooperativeFixture("answer",(kind,id,context)=>guard.admit(kind,id,context),(id,context,evidence)=>guard.result(id,context,evidence),guard);return {now:()=>state.now,models:f.models,registry:f.registry,settings:{extensions:[f.extension],retry:{enabled:false},compaction:{enabled:false,backgroundTokens:0}}};},
		};
		const host=await PiDurableHost.open(ctx.storage,dependencies);
		try{await run(host,ctx.storage,state);}finally{state.release();await host.yield().catch(()=>{});await host.awaitClosure().catch(()=>{});await ctx.storage.deleteAlarm();}
	});
}
it.each(["stop","cancel"] as const)("advisor: concurrent identical %s receipts do not poison persistent safety",async(kind)=>{
	await probe(`advisor-duplicate-${kind}`,async(host,storage,state)=>{
		const command=control(state.now,kind), target=prompt(state.now);
		const results=await Promise.allSettled([host.acceptCandidate(command,target),host.acceptCandidate(command,target)]);
		const statuses=results.map(r=>r.status);
		const blocks=storage.sql.exec("SELECT * FROM host_safety").toArray();
		console.log("advisor-duplicate",JSON.stringify({kind,statuses,blockCount:blocks.length}));
		expect(statuses).toEqual(["fulfilled","fulfilled"]);
		expect(blocks).toHaveLength(0);
		if(results[0].status==="fulfilled"&&results[1].status==="fulfilled")expect(results[0].value).toEqual(results[1].value);
	});
});
it("advisor: a deadline crossed at the start commit becomes expiry, not storage failure",async()=>{
	await probe("advisor-start-deadline",async(host,storage,state)=>{
		await host.acceptCandidate(prompt(state.now));state.crossStart=true;
		const result=await host.alarm().then(()=>"resolved",(error:unknown)=>error instanceof Error?error.message:"rejected");
		const blocks=storage.sql.exec("SELECT * FROM host_safety").toArray();
		const member=storage.sql.exec("SELECT state FROM host_members").one().state;
		console.log("advisor-deadline",JSON.stringify({result,blockCount:blocks.length,member}));
		expect(blocks).toHaveLength(0);
		expect(member).toBe("failed");
	});
});
it("advisor: yield cancels a held candidate product callback within the existing drain budget",async()=>{
	await probe("advisor-callback-close",async(host,_storage,state)=>{
		const input=prompt(state.now);await host.acceptCandidate(input);state.now=input.deadlineAt;state.held=true;
		const alarm=host.alarm().catch(()=>{});
		await expect.poll(()=>state.entered).toBe(true);
		const closing=host.yield();
		let elapsed:ReturnType<typeof setTimeout>;
		const result=await Promise.race([closing.then(()=>"closed",()=>"failed"),new Promise<string>(resolve=>{elapsed=setTimeout(()=>resolve("pending"),1200);})]);
		clearTimeout(elapsed!);
		console.log("advisor-callback",JSON.stringify({result}));
		state.release();await alarm;await closing.catch(()=>{});
		expect(result).toBe("closed");
	});
});
