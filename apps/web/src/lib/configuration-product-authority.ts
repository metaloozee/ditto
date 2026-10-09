import {
	type ConfigurationAuthorityV1,
	parseConfigurationReadV1,
	parseConfigurationSelectionV1,
} from "../../../../packages/runtime-contracts/src/configuration.js";
import type { ModelSubjectV1 } from "../../../../packages/runtime-contracts/src/model.js";
import { ModelProductAuthority } from "./model-product-authority";

// The subject is bound by deployment composition, never taken from the RPC payload.
export async function readOwnedConfigurationAuthority(
	db: D1Database,
	authenticated: ModelSubjectV1,
	input: unknown,
	selection: unknown,
	fixtureAvailable: boolean,
): Promise<ConfigurationAuthorityV1> {
	if (!fixtureAvailable) return { version: 1, status: "unavailable" };
	try {
		const query = parseConfigurationReadV1(input);
		const value =
			selection === undefined
				? undefined
				: parseConfigurationSelectionV1(selection);
		return (await new ModelProductAuthority(db).ownedConfiguration(
			authenticated,
			query,
			value,
		))
			? { version: 1, status: "current", subject: authenticated }
			: { version: 1, status: "denied" };
	} catch {
		return { version: 1, status: "denied" };
	}
}
