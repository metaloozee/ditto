import { createFlueClient } from "@flue/sdk";

const BASE_URL = import.meta.env.BASE_URL;

export const flueClient = createFlueClient({
	baseUrl: `https://${BASE_URL}/api/flue`,
});
