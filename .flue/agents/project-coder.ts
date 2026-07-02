import { getSandbox } from "@cloudflare/sandbox";
import { createAgent } from "@flue/runtime";
import { cloudflareSandbox } from "@flue/runtime/cloudflare";

type FlueProjectCoderEnv = {
	Sandbox: DurableObjectNamespace;
};

const instructions = `You are Ditto's project-coder spike agent.

Do not mutate files during this architecture spike. Confirm that you can run inside the existing project sandbox boundary and answer from repository evidence only.`;

export default createAgent<unknown, FlueProjectCoderEnv>(({ id, env }) => {
	const [projectId, sandboxId = id] = id.split(":", 2);

	return {
		model: "anthropic/claude-sonnet-4-6",
		instructions,
		metadata: { projectId },
		sandbox: cloudflareSandbox(getSandbox(env.Sandbox, sandboxId)),
	};
});
