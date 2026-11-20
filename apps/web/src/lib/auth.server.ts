import { env } from "cloudflare:workers";

import { createAuth } from "./auth.ts";

// Only the Worker can load this module. Import it dynamically from server
// code so pages like /design still render on a plain Vite server.
export const auth = createAuth(env);
