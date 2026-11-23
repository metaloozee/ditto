// Stands in for the `AI` binding in the paid stage's test stage (#35). Bound as a service, so
// the Bot calls `fetch` and, over RPC, `gateway(id).getLog(logId)`, as it does on the real binding.
import { RpcTarget, WorkerEntrypoint } from "cloudflare:workers";

import { simulatedWorkersAi } from "./simulated-workers-ai.ts";

// One simulated binding per isolate: its gateway log lasts as long as the test stage. The
// gateway ID matches the test stage's AI_GATEWAY_ID in paid/alchemy.run.ts.
const ai = simulatedWorkersAi({ gatewayId: "simulated-gateway" });

class GatewayLogs extends RpcTarget {
	constructor(private id: string) {
		super();
	}
	getLog(logId: string) {
		return ai.gateway(this.id).getLog(logId);
	}
}

export default class SimulatedWorkersAi extends WorkerEntrypoint {
	override fetch(request: Request) {
		return ai.fetch(request);
	}
	gateway(id: string) {
		return new GatewayLogs(id);
	}
}
