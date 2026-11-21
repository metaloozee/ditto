// Minimal Chrome DevTools Protocol client: launches headless Chromium and
// drives pages through flattened target sessions. No dependencies; needs Node 22+.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export function findChrome() {
	if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
	const cache = join(homedir(), ".cache/ms-playwright");
	if (existsSync(cache)) {
		const builds = readdirSync(cache)
			.filter((d) => /^chromium-\d+$/.test(d))
			.sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
		for (const b of builds) {
			for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
				const p = join(cache, b, sub);
				if (existsSync(p)) return p;
			}
		}
	}
	for (const p of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]) {
		if (existsSync(p)) return p;
	}
	return undefined;
}

export async function launch({ headed = false } = {}) {
	const chrome = findChrome();
	if (!chrome) throw new Error("No Chromium found. Set CHROME_PATH or run `npx playwright install chromium`.");
	const profile = mkdtempSync(join(tmpdir(), "verify-brand-"));
	const args = [
		`--user-data-dir=${profile}`,
		"--remote-debugging-port=0",
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-background-timer-throttling",
		"--disable-renderer-backgrounding",
		"--disable-backgrounding-occluded-windows",
		"--window-size=1280,900",
		"--no-sandbox",
		"about:blank",
	];
	if (!headed) args.unshift("--headless=new");
	const proc = spawn(chrome, args, { stdio: ["ignore", "ignore", "pipe"] });
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = "";
		const timer = setTimeout(() => reject(new Error(`Chromium did not start:\n${buf}`)), 20000);
		proc.stderr.on("data", (d) => {
			buf += d;
			const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
			if (m) {
				clearTimeout(timer);
				resolve(m[1]);
			}
		});
		proc.on("exit", (code) => reject(new Error(`Chromium exited ${code}:\n${buf}`)));
	});
	const ws = new WebSocket(wsUrl);
	await new Promise((r, j) => {
		ws.onopen = r;
		ws.onerror = j;
	});
	const browser = new Browser(ws, proc, profile);
	return browser;
}

class Browser {
	#id = 0;
	#pending = new Map();
	#listeners = new Set();
	constructor(ws, proc, profile) {
		this.ws = ws;
		this.proc = proc;
		this.profile = profile;
		ws.onmessage = (e) => {
			const msg = JSON.parse(e.data);
			if (msg.id && this.#pending.has(msg.id)) {
				const { resolve, reject, method } = this.#pending.get(msg.id);
				this.#pending.delete(msg.id);
				if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
				else resolve(msg.result);
			} else if (msg.method) {
				for (const l of this.#listeners) l(msg);
			}
		};
	}
	send(method, params = {}, sessionId) {
		const id = ++this.#id;
		this.ws.send(JSON.stringify({ id, method, params, sessionId }));
		return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject, method }));
	}
	waitEvent(method, sessionId, timeout = 30000) {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#listeners.delete(fn);
				reject(new Error(`Timed out waiting for ${method}`));
			}, timeout);
			const fn = (msg) => {
				if (msg.method === method && msg.sessionId === sessionId) {
					clearTimeout(timer);
					this.#listeners.delete(fn);
					resolve(msg.params);
				}
			};
			this.#listeners.add(fn);
		});
	}
	/** A fresh browser context has its own empty localStorage. */
	async context() {
		const { browserContextId } = await this.send("Target.createBrowserContext");
		return browserContextId;
	}
	async page(browserContextId) {
		const { targetId } = await this.send("Target.createTarget", { url: "about:blank", browserContextId });
		const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
		const page = new Page(this, sessionId);
		await page.send("Page.enable");
		await page.send("Runtime.enable");
		await page.send("Emulation.setDeviceMetricsOverride", {
			width: 1280,
			height: 900,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
		return page;
	}
	async close() {
		try {
			await this.send("Browser.close");
		} catch {}
		this.proc.kill("SIGKILL");
		rmSync(this.profile, { recursive: true, force: true });
	}
}

class Page {
	constructor(browser, sessionId) {
		this.browser = browser;
		this.sessionId = sessionId;
	}
	send(method, params) {
		return this.browser.send(method, params, this.sessionId);
	}
	async goto(url) {
		const loaded = this.browser.waitEvent("Page.loadEventFired", this.sessionId);
		await this.send("Page.navigate", { url });
		await loaded;
	}
	async reload() {
		const loaded = this.browser.waitEvent("Page.loadEventFired", this.sessionId);
		await this.send("Page.reload");
		await loaded;
	}
	async eval(fn, ...args) {
		const expression = `(${fn})(...${JSON.stringify(args)})`;
		const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (exceptionDetails) {
			throw new Error(`eval failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
		}
		return result.value;
	}
	async mouse(type, x, y, extra = {}) {
		await this.send("Input.dispatchMouseEvent", {
			type,
			x,
			y,
			button: type === "mouseMoved" ? "none" : "left",
			buttons: type === "mousePressed" ? 1 : 0,
			clickCount: type === "mouseMoved" ? 0 : 1,
			...extra,
		});
	}
	async screenshot(path, clip) {
		const { data } = await this.send("Page.captureScreenshot", {
			format: "png",
			...(clip ? { clip: { ...clip, scale: 1 } } : {}),
		});
		const { writeFileSync } = await import("node:fs");
		writeFileSync(path, Buffer.from(data, "base64"));
	}
	async reducedMotion(on) {
		await this.send("Emulation.setEmulatedMedia", {
			features: [{ name: "prefers-reduced-motion", value: on ? "reduce" : "no-preference" }],
		});
	}
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
