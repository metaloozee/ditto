// Runs the auth test suite's fake GitHub, Google and Resend until killed, so a
// verify-auth stage can point its Worker at them. Prints `upstream: <url>`.
import { startFakeUpstream } from "../../../../apps/web/tests/auth/fake-upstream.ts";

const upstream = await startFakeUpstream();
console.log(`upstream: ${upstream.url}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
	process.on(signal, () => void upstream.close().then(() => process.exit(0)));
