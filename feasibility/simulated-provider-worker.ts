import { simulatedProvider } from "./simulated-provider.ts";

// One provider per isolate: its token generation lasts as long as the test stage.
const provider = simulatedProvider();

export default { fetch: (request: Request) => provider.fetch(request) };
