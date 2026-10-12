import { DurableObject } from "cloudflare:workers";
export class Bare extends DurableObject {
 async denied() { await this.ctx.storage.put("synthetic-marker", true); await this.ctx.storage.sync(); throw new Error("minimal-denied"); }
}
export default { fetch() { return new Response("Not found", { status: 404 }); } };
