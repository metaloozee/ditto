import { DurableObject } from "cloudflare:workers";
export class Bare extends DurableObject {
 denied() { return "minimal-denied"; }
}
export default { fetch() { return new Response("Not found", { status: 404 }); } };
