import { describe, expect, it } from "vite-plus/test";

import { SIMULATED_COST, simulatedWorkersAi } from "./simulated-workers-ai.ts";
import { formatWorkersAiEvidence, runWorkersAiTrial } from "./workers-ai-trial.ts";

const GATEWAY = "ditto-paid-pi-trial-gateway";
const ACCOUNT = "trial-account-1";

describe("Workers AI trial (#35)", () => {
	it("passes a plain turn and a tool-calling turn through AI Gateway on the AI binding", async () => {
		const run = await runWorkersAiTrial({
			ai: simulatedWorkersAi({ gatewayId: GATEWAY }),
			gatewayId: GATEWAY,
			account: ACCOUNT,
			model: "@cf/deepseek-ai/deepseek-v4.1-flash-1017",
		});

		expect(run.outcome).toBe("pass");
		expect(run.turns.map((t) => [t.label, t.ok])).toEqual([
			["plain turn", true],
			["tool-calling turn", true],
		]);
		// The tool turn is a request that calls the tool and one that answers with its result.
		expect(run.turns.map((t) => t.requests.length)).toEqual([1, 2]);
		for (const request of run.turns.flatMap((t) => t.requests)) {
			expect(request.log?.metadata).toEqual({ dittoAccount: ACCOUNT });
			expect(request.log?.cost).toBe(SIMULATED_COST);
		}
	});

	it("records a model that answers instead of calling the tool as a failed tool-calling turn", async () => {
		const run = await runWorkersAiTrial({
			ai: simulatedWorkersAi({ gatewayId: GATEWAY, toolCalls: false }),
			gatewayId: GATEWAY,
			account: ACCOUNT,
			model: "@cf/openai/gpt-oss-20b",
		});

		expect(run.outcome).toBe("fail");
		const entry = formatWorkersAiEvidence([run], { origin: "Bot Durable Object" });
		expect(entry).toMatch(
			/^#### \d{4}-\d{2}-\d{2} · Workers AI `@cf\/openai\/gpt-oss-20b` from Bot Durable Object · fail\n/,
		);
		expect(entry).toContain('no call to `get_secret_word`: answered "I cannot call tools"');
		expect(entry).toContain("- **Fallback:** none yet: try another `@cf/` model");
	});

	it("prints a dated entry with both turns, latency, cost, attribution and the Bot's CPU", async () => {
		const runs = [];
		for (let i = 0; i < 2; i++) {
			const run = await runWorkersAiTrial({
				ai: simulatedWorkersAi({ gatewayId: GATEWAY }),
				gatewayId: GATEWAY,
				account: ACCOUNT,
				now: () => new Date(`2026-11-24T09:0${i}:00Z`),
			});
			runs.push({ ...run, request: { cpuMs: 42 + i, wallMs: 1800 } });
		}

		const entry = formatWorkersAiEvidence(runs, { origin: "Bot Durable Object (data centre SIN)" });

		expect(entry).toMatch(
			/^#### 2026-11-24 · Workers AI `@cf\/deepseek-ai\/deepseek-v4.1-flash-1017` from Bot Durable Object \(data centre SIN\) · pass\n/,
		);
		expect(entry).toContain("- **Date:** 2026-11-24, 09:00 UTC");
		expect(entry).toMatch(
			/- \*\*Observed:\*\* plain turn passed in \d+ms \(1 request\): replied "pong"/,
		);
		expect(entry).toMatch(
			/tool-calling turn passed in \d+ms \(2 requests\): called `get_secret_word`, then replied with its result/,
		);
		expect(entry).toContain("2 of 2 runs passed.");
		expect(entry).toContain("- **Retries:** 09:01 UTC pass");
		expect(entry).toContain(
			"- **Cost:** as AI Gateway logged it, run 1: plain turn $0.000011, tool-calling turn $0.000022; run 2:",
		);
		expect(entry).toContain(
			"- **Attribution:** 6 of 6 requests logged by AI Gateway with metadata `dittoAccount: trial-account-1`",
		);
		expect(entry).toContain(
			"- **CPU time:** run 1: 42ms CPU, 1800ms wall; run 2: 43ms CPU, 1800ms wall, from the Bot's tail event.",
		);
	});
});
