import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

export type ParsedModelSpecifier = {
	provider: string;
	modelId: string;
};

export type ResolvedRunnerModel = {
	modelRuntime: ModelRuntime;
	model: NonNullable<ReturnType<ModelRuntime["getModel"]>>;
	provider: string;
	modelId: string;
};

const MODEL_SPECIFIER_MAX = 128;

export function parseModelSpecifier(
	modelSpecifier: string,
): ParsedModelSpecifier | { error: string } {
	if (
		typeof modelSpecifier !== "string" ||
		modelSpecifier.length === 0 ||
		modelSpecifier.length > MODEL_SPECIFIER_MAX ||
		modelSpecifier.includes("\0")
	) {
		return { error: "Unknown model: invalid specifier" };
	}
	const slash = modelSpecifier.indexOf("/");
	if (slash <= 0 || slash === modelSpecifier.length - 1) {
		return { error: `Unknown model: ${modelSpecifier}` };
	}

	return {
		provider: modelSpecifier.slice(0, slash),
		modelId: modelSpecifier.slice(slash + 1),
	};
}

/**
 * Resolve a provider/model and seed an in-memory credential store.
 * Deletes DITTO_PI_CREDENTIAL and OPENCODE_API_KEY from the process env before
 * any Agent Session or tool can start (including on error paths after parse).
 * Never returns credential material.
 */
export async function resolveRunnerModel(
	modelSpecifier: string,
): Promise<ResolvedRunnerModel | { error: string }> {
	const parsed = parseModelSpecifier(modelSpecifier);
	if ("error" in parsed) {
		// Still scrub env so a bad specifier cannot leave secrets for later tools.
		delete process.env.DITTO_PI_CREDENTIAL;
		delete process.env.OPENCODE_API_KEY;
		return parsed;
	}

	const credentials = new InMemoryCredentialStore();
	const rawCredential =
		process.env.DITTO_PI_CREDENTIAL ?? process.env.OPENCODE_API_KEY;
	// Delete before session/tools so bash children cannot inherit secrets.
	delete process.env.DITTO_PI_CREDENTIAL;
	delete process.env.OPENCODE_API_KEY;

	if (rawCredential) {
		let credential: { type: string; [key: string]: unknown };
		try {
			const parsedCred = JSON.parse(rawCredential) as {
				type?: string;
			};
			if (parsedCred && typeof parsedCred === "object" && parsedCred.type) {
				credential = parsedCred as { type: string; [key: string]: unknown };
			} else {
				// Legacy bare API key string (operator bridge).
				credential = { type: "api_key", key: rawCredential };
			}
		} catch {
			credential = { type: "api_key", key: rawCredential };
		}
		await credentials.modify(parsed.provider, async () => credential as never);
	}

	const modelRuntime = await ModelRuntime.create({
		credentials,
		modelsPath: null,
		allowModelNetwork: false,
	});
	const model = modelRuntime.getModel(parsed.provider, parsed.modelId);
	if (!model) {
		return { error: `Unknown model: ${modelSpecifier}` };
	}

	return {
		modelRuntime,
		model,
		provider: parsed.provider,
		modelId: parsed.modelId,
	};
}
