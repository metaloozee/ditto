#!/usr/bin/env node
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
	isPortableProviderId,
	PORTABLE_PROVIDER_AUTH,
	type PortableProviderId,
	projectSafeModels,
} from "./provider-auth.js";

type CatalogProvider = {
	providerId: string;
	name: string;
	authMethods: Array<{ type: "api_key" | "oauth"; label: string }>;
	models: ReturnType<typeof projectSafeModels>;
};

async function main(): Promise<number> {
	const credentials = new InMemoryCredentialStore();
	const runtime = await ModelRuntime.create({
		credentials,
		modelsPath: null,
		allowModelNetwork: false,
	});

	const providers: CatalogProvider[] = [];
	for (const providerId of Object.keys(
		PORTABLE_PROVIDER_AUTH,
	) as PortableProviderId[]) {
		if (!isPortableProviderId(providerId)) continue;
		const provider = runtime.getProvider(providerId);
		if (!provider) continue;
		const allowed = PORTABLE_PROVIDER_AUTH[providerId];
		const authMethods: CatalogProvider["authMethods"] = [];
		for (const type of allowed) {
			if (type === "api_key" && provider.auth?.apiKey?.login) {
				authMethods.push({
					type: "api_key",
					label: provider.auth.apiKey.name || "API key",
				});
			}
			if (type === "oauth" && provider.auth?.oauth) {
				authMethods.push({
					type: "oauth",
					label:
						provider.auth.oauth.loginLabel ||
						provider.auth.oauth.name ||
						"Subscription",
				});
			}
		}
		if (authMethods.length === 0) continue;
		let models: ReturnType<typeof projectSafeModels> = [];
		try {
			models = projectSafeModels(runtime, providerId);
		} catch {
			models = [];
		}
		providers.push({
			providerId,
			name: provider.name || providerId,
			authMethods,
			models,
		});
	}

	process.stdout.write(`${JSON.stringify({ v: 1, providers })}\n`);
	return 0;
}

main()
	.then((code) => process.exit(code))
	.catch(() => {
		process.stderr.write("catalog_failed\n");
		process.exit(1);
	});
