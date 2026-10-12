import { DurableObject } from "cloudflare:workers";
export class Bare extends DurableObject {
 readonly boot = crypto.randomUUID();
 async seed() { this.ctx.storage.sql.exec("CREATE TABLE retained(value TEXT)"); this.ctx.storage.sql.exec("INSERT INTO retained VALUES('synthetic')"); await this.ctx.storage.put("marker", "synthetic"); await this.ctx.storage.sync(); return true; }
 reset(label: string) { this.ctx.abort(label); }
 async denied() { await this.ctx.storage.get("marker"); this.ctx.storage.sql.exec("SELECT * FROM retained").toArray(); throw new Error("bare-denied"); }
 read() { return this.ctx.storage.sql.exec("SELECT * FROM retained").one().value; }
 fetch() { return new Response("Not found", { status: 404 }); }
}
export default { fetch() { return new Response("Not found", { status: 404 }); } };
