import fs from "node:fs";
import {
	type Authority,
	type BarrierName,
	type CrashPosition,
	recoverCommittedBatch,
	runBarrierScenario,
} from "./pi-recovery.ts";

interface RecoverRequest {
	action: "recover";
	journalDir: string;
	imageOwnedCwd: string;
	agentDir: string;
	expectedAuthority: Authority;
}
interface BarrierRequest {
	action: "barrier";
	journalDir: string;
	barrier: BarrierName;
	pauseAt: CrashPosition | "never";
}
const request = JSON.parse(fs.readFileSync(process.argv[2] ?? "", "utf8")) as
	| RecoverRequest
	| BarrierRequest;
if (request.action === "recover")
	process.stdout.write(
		JSON.stringify(
			await recoverCommittedBatch(
				request.journalDir,
				request.imageOwnedCwd,
				request.expectedAuthority,
			),
		),
	);
else
	await runBarrierScenario(
		request.journalDir,
		request.journalDir,
		request.barrier,
		{ incarnation: "brain-1", epoch: 1, attempt: 1 },
		(point) => {
			if (point !== request.pauseAt) return;
			fs.writeSync(1, `POINT ${point}\n`);
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
		},
	);
