#!/usr/bin/env node
// Drives the Ditto brand mark in headless Chromium and checks it against the
// spec below. MODEL restates the motion laws in apps/web/src/components/ditto-mark.tsx;
// each frame the app renders is replayed through MODEL from the recorded frame
// timestamps and must match to floating-point precision, so a changed constant,
// easing, spring or ordering fails regardless of how fast the machine is.
//
//   node brand-check.mjs [--base URL] [--out DIR] [--only id,id] [--update-baseline] [--headed]
//
// Exit 0 when every check passes, 1 when any fails, 2 when the run itself broke.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { launch, sleep } from "./cdp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const BASELINE = join(here, "../baseline/moods.json");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 ? argv[i + 1] : fallback;
};
const BASE = opt("base", process.env.VERIFY_BRAND_URL ?? "http://127.0.0.1:4517");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const OUT = resolve(opt("out", join(repo, ".scratch/verify-brand", stamp)));
const ONLY = opt("only")?.split(",");
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- spec

const SPEC = {
	// MOODS key order; a click advances one step and wraps.
	order: ["neutral", "happy", "love", "surprised", "wink", "angry", "sad", "dizzy", "sleepy"],
	storageKey: "ditto-mood",
	label: (m) => `Ditto, feeling ${m}. Change mood`,
	marksOnDesign: 1,
	marksOnAuthDesigns: 8,
};

// Each line mirrors one expression in ditto-mark.tsx, written the same way so
// the floating-point results are bit-identical. Change one only when the user
// has approved the matching change to the component.
const MODEL = {
	dt: (t, prev) => Math.min((t - prev) / 1000, 0.064),
	eyeK: (dt) => 1 - Math.exp(-dt / 0.02),
	spring(s, target, stiffness, damping, dt) {
		s.v += (stiffness * (target - s.x) - damping * s.v) * dt;
		s.x += s.v * dt;
	},
	lean: { stiffness: 260, damping: 24 },
	hop: { stiffness: 300, damping: 16, kick: -150 },
	squash: { stiffness: 600, damping: 20, pressed: 0.92, kick: 3 },
	yaw: (ex) => ex * (Math.PI / 4),
	pitch: (ey) => ey * (Math.PI / 5),
	eyeX: (yaw) => 8.5 * Math.sin(yaw),
	eyeY: (pitch) => 7.5 * Math.sin(pitch),
	eyeSx: (yaw) => Math.sqrt(Math.cos(yaw)),
	eyeSy: (pitch, open) => Math.sqrt(Math.cos(pitch)) * open,
	breath: (t) => 1 + 0.012 * Math.sin((t * 2 * Math.PI) / 3.4),
	float: (t) => 0.6 * Math.sin((t * 2 * Math.PI) / 4.1),
	swayX: (t) => 0.04 * Math.sin(t * 0.9) + 0.025 * Math.sin(t * 2.3),
	swayY: (t) => 0.03 * Math.sin(t * 1.1 + 1) + 0.02 * Math.sin(t * 2.9),
	bodyX: (lx) => lx * 2.5,
	bodyY: (ly, t, hop) => ly * 1.5 + MODEL.float(t) + hop,
	rotate: (lx) => lx * 4,
	blink: { close: 90, hold: 50, open: 140 },
	lid(elapsed) {
		const B = MODEL.blink;
		if (elapsed >= B.close + B.hold + B.open) return 1;
		if (elapsed < B.close) return 0.1 + 0.9 * ((1 + Math.cos((Math.PI * elapsed) / B.close)) / 2);
		const opening = elapsed - B.close - B.hold;
		if (opening <= 0) return 0.1;
		return 0.1 + 0.9 * ((1 - Math.cos((Math.PI * opening) / B.open)) / 2);
	},
	gaze(dx, dy) {
		const dist = Math.hypot(dx, dy) || 1;
		const pull = 1 - Math.exp(-dist / 220);
		return { x: (dx / dist) * pull, y: (dy / dist) * pull };
	},
	idleAfter: 2500,
	glanceEvery: [1500, 4000],
	glanceRange: { x: [-0.6, 0.6], y: [-0.45, 0.35] },
	blinkEvery: [3500, 7000],
	doubleBlinkGap: [280 + 80, 280 + 140],
};
const EXACT = 1e-9;

// ---------------------------------------------------------------- in-page probe

// Read-only: queries the rendered DOM and records frames. Never calls app code.
// Its rAF callback is registered after the app's loop starts, so in every frame
// it runs after the app's tick and sees that tick's output with the same timestamp.
const PROBE = () => {
	if (window.__vb) return;
	const num = "(-?[\\d.]+(?:e[-+]?\\d+)?)";
	const BODY = new RegExp(
		`^translate\\(${num} ${num}\\) rotate\\(${num} 50 50\\) translate\\(50 90\\) scale\\(${num} ${num}\\) translate\\(-50 -90\\)$`,
	);
	const EYES = new RegExp(
		`^translate\\(${num} ${num}\\) translate\\(50 49\\.3\\) scale\\(${num} ${num}\\) translate\\(-50 -49\\.3\\)$`,
	);
	const marks = () => [...document.querySelectorAll('button[aria-label^="Ditto, feeling"]')];
	const parts = (btn) => {
		const body = btn.querySelector("svg")?.querySelector(":scope > g");
		const clips = body ? [...body.querySelectorAll(":scope > g[clip-path]")] : [];
		return {
			body,
			bloom: clips[0]?.querySelector("g[filter] > g") ?? null,
			eyes: clips[1]?.querySelector(":scope > g") ?? null,
		};
	};
	const read = (i) => {
		const btn = marks()[i];
		if (!btn) return null;
		const p = parts(btn);
		const bt = p.body?.getAttribute("transform") ?? null;
		const et = p.eyes?.getAttribute("transform") ?? null;
		const bm = bt?.match(BODY);
		const em = et?.match(EYES);
		return {
			label: btn.getAttribute("aria-label"),
			bodyRaw: bt,
			eyesRaw: et,
			bloomRaw: p.bloom?.getAttribute("transform") ?? null,
			body: bm ? { x: +bm[1], y: +bm[2], r: +bm[3], sx: +bm[4], sy: +bm[5] } : null,
			eyes: em ? { x: +em[1], y: +em[2], sx: +em[3], sy: +em[4] } : null,
			eyeD: p.eyes?.querySelector("path")?.getAttribute("d") ?? null,
		};
	};
	const events = [];
	for (const type of ["pointermove", "pointerdown", "pointerup", "click"]) {
		window.addEventListener(
			type,
			(e) => events.push({ type, at: performance.now(), stamp: e.timeStamp, x: e.clientX, y: e.clientY }),
			{ capture: true },
		);
	}
	let frames = [];
	let sampling = 0;
	window.__vb = {
		marks,
		read,
		events,
		count: () => marks().length,
		hydrated: () =>
			marks().length > 0 && marks().every((b) => Object.keys(b).some((k) => k.startsWith("__reactProps"))),
		rect: (i) => {
			const r = marks()[i].getBoundingClientRect();
			return { x: r.x, y: r.y, width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
		},
		markup: (i) => marks()[i].outerHTML.replace(/ditto-\w*-(plate|bezel|well|bloom|screen)/g, "ID-$1"),
		sample(i) {
			frames = [];
			const tick = (t) => {
				frames.push({ t, at: performance.now(), ...read(i) });
				sampling = requestAnimationFrame(tick);
			};
			sampling = requestAnimationFrame(tick);
		},
		stop() {
			cancelAnimationFrame(sampling);
			return frames;
		},
		now: () => performance.now(),
	};
};

// ---------------------------------------------------------------- harness

let browser;
let contexts = [];

async function open(path, { context, reduced = false } = {}) {
	const ctx = context ?? (await browser.context());
	if (!context) contexts.push(ctx);
	const page = await browser.page(ctx);
	await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `(${PROBE})()` });
	await page.reducedMotion(reduced);
	await page.goto(BASE + path);
	await hydrated(page);
	if (!reduced) await animating(page);
	page.ctx = ctx;
	return page;
}

async function closeAll() {
	for (const id of contexts) {
		try {
			await browser.send("Target.disposeBrowserContext", { browserContextId: id });
		} catch {}
	}
	contexts = [];
}

async function waitFor(fn, timeout = 2000) {
	const start = Date.now();
	let last;
	while (Date.now() - start < timeout) {
		last = await fn();
		if (last === true) return true;
		await sleep(30);
	}
	return last;
}

async function hydrated(page) {
	const ok = await waitFor(() => page.eval(() => Boolean(window.__vb?.hydrated())), 20000);
	if (ok !== true) throw new Error("Brand mark never hydrated (no React props on the button).");
}

async function animating(page) {
	const ok = await waitFor(async () => Boolean(await page.eval(() => window.__vb.read(0)?.bodyRaw)), 5000);
	if (ok !== true) throw new Error("Mark never started animating (no transform on its body group).");
}

const mood = (label) => label?.match(/^Ditto, feeling (\w+)\. Change mood$/)?.[1];
const moods = (page) => page.eval(() => window.__vb.marks().map((b) => b.getAttribute("aria-label")));
const events = (page) => page.eval(() => window.__vb.events.slice());

async function click(page, i = 0) {
	const r = await page.eval((i) => window.__vb.rect(i), i);
	await page.mouse("mouseMoved", r.cx, r.cy);
	await page.mouse("mousePressed", r.cx, r.cy);
	await page.mouse("mouseReleased", r.cx, r.cy);
}

async function record(page, ms, during) {
	await page.eval(() => window.__vb.sample(0));
	await (during ? during() : sleep(ms));
	if (during && ms) await sleep(ms);
	return page.eval(() => window.__vb.stop());
}

function expectNear(errors, name, actual, expected, tol) {
	const ok = Math.abs(actual - expected) <= tol;
	if (!ok) errors.push(`${name}: got ${fmt(actual)}, want ${fmt(expected)} ± ${tol}`);
	return { name, actual, expected, tol, ok };
}
function expectIn(errors, name, actual, lo, hi) {
	const ok = actual >= lo && actual <= hi;
	if (!ok) errors.push(`${name}: got ${fmt(actual)}, want [${lo}, ${hi}]`);
	return { name, actual, lo, hi, ok };
}
function expectEq(errors, name, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) errors.push(`${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
	return { name, actual, expected, ok };
}
const fmt = (n) => (typeof n === "number" ? (Math.abs(n) < 1e-3 && n !== 0 ? n.toExponential(3) : n.toFixed(4)) : String(n));

function saveFrames(id, frames) {
	writeFileSync(join(OUT, `frames-${id}.json`), JSON.stringify(frames));
}

// ---------------------------------------------------------------- frame analysis

/**
 * Recovers the hidden state of each frame from what was drawn, then replays one
 * frame of MODEL from the previous frame's state and reports how far the drawn
 * frame is from the replay. hopAt marks frames whose y includes a hop.
 */
function analyze(frames) {
	const f = frames.filter((x) => x.body && x.eyes);
	const out = [];
	for (let i = 0; i < f.length; i++) {
		const { t, at, body, eyes } = f[i];
		const s = t / 1000;
		const ex = Math.asin(eyes.x / 8.5) / (Math.PI / 4);
		const ey = Math.asin(eyes.y / 7.5) / (Math.PI / 5);
		const breath = (body.sx + body.sy) / 2;
		const squash = body.sy / breath;
		const row = { t, at, ex, ey, breath, squash, lx: body.x / 2.5, lid: eyes.sy / Math.sqrt(Math.cos(MODEL.pitch(ey))) };
		row.res = {
			breath: Math.abs(breath - MODEL.breath(s)),
			rotate: Math.abs(body.r - MODEL.rotate(row.lx)),
			eyeSx: Math.abs(eyes.sx - MODEL.eyeSx(MODEL.yaw(ex))),
		};
		if (i > 0) {
			const p = out[i - 1];
			const dt = MODEL.dt(t, p.t);
			const k = MODEL.eyeK(dt);
			row.dt = dt;
			// The gaze this tick aimed at, recovered from how far the eyes moved.
			row.gx = p.ex + (ex - p.ex) / k;
			row.gy = p.ey + (ey - p.ey) / k;
			row.glanceX = row.gx - MODEL.swayX(s);
			row.glanceY = row.gy - MODEL.swayY(s);
			if (i > 1) {
				const pv = (p.lx - out[i - 2].lx) / p.dt;
				const lean = { x: p.lx, v: pv };
				MODEL.spring(lean, row.gx, MODEL.lean.stiffness, MODEL.lean.damping, dt);
				row.res.leanX = Math.abs(body.x - MODEL.bodyX(lean.x));
			}
		}
		out.push(row);
	}
	return out;
}

const maxRes = (rows, key, from = 0) =>
	Math.max(0, ...rows.slice(from).map((r) => r.res[key]).filter((v) => v !== undefined));

/** Lean y can only be recovered when no hop is in flight. */
function leanYResiduals(rows, frames) {
	const f = frames.filter((x) => x.body && x.eyes);
	const ly = f.map((x) => (x.body.y - MODEL.float(x.t / 1000)) / 1.5);
	let worst = 0;
	for (let i = 2; i < f.length; i++) {
		const lean = { x: ly[i - 1], v: (ly[i - 1] - ly[i - 2]) / rows[i - 1].dt };
		MODEL.spring(lean, rows[i].gy, MODEL.lean.stiffness, MODEL.lean.damping, rows[i].dt);
		worst = Math.max(worst, Math.abs(f[i].body.y - MODEL.bodyY(lean.x, f[i].t / 1000, 0)));
	}
	return worst;
}

/** Blinks are runs of frames with the lid below 1. Fits each start time and checks every frame of the run. */
function blinksOf(rows) {
	const blinks = [];
	let run;
	for (let i = 0; i < rows.length; i++) {
		if (rows[i].lid < 1 - 1e-12) {
			run ??= { from: i, to: i };
			run.to = i;
		} else if (run) {
			blinks.push(run);
			run = undefined;
		}
	}
	return blinks.map((b) => {
		// Invert the easing on frames away from the flat ends, where it is well conditioned.
		const starts = [];
		let shut = b.from;
		for (let i = b.from; i <= b.to; i++) if (rows[i].lid < rows[shut].lid) shut = i;
		for (let i = b.from; i <= b.to; i++) {
			const { lid, t } = rows[i];
			if (lid < 0.15 || lid > 0.95) continue;
			const u = (lid - 0.1) / 0.9;
			const closing = i < shut;
			const B = MODEL.blink;
			const e = closing
				? (Math.acos(2 * u - 1) * B.close) / Math.PI
				: B.close + B.hold + (Math.acos(1 - 2 * u) * B.open) / Math.PI;
			starts.push(t - e);
		}
		starts.sort((a, z) => a - z);
		const start = starts[Math.floor(starts.length / 2)] ?? rows[b.from].t;
		let worst = 0;
		for (let i = Math.max(0, b.from - 1); i <= Math.min(rows.length - 1, b.to + 1); i++) {
			// A tick that ran before the blink began drew open eyes, whatever its frame time.
			const want = rows[i].at < start ? 1 : MODEL.lid(rows[i].t - start);
			worst = Math.max(worst, Math.abs(rows[i].lid - want));
		}
		return { start, worst, frames: b.to - b.from + 1, firstT: rows[b.from].t };
	});
}

// ---------------------------------------------------------------- checks

const check = (id, title, run) => ({ id, title, run });

const CHECKS = [
	check("ssr-neutral", "Server renders every mark neutral", async () => {
		const errors = [];
		const facts = [];
		for (const [path, n] of [
			["/design", SPEC.marksOnDesign],
			["/design/auth", SPEC.marksOnAuthDesigns],
		]) {
			const html = await (await fetch(BASE + path)).text();
			const labels = [...html.matchAll(/aria-label="(Ditto, feeling [^"]*)"/g)].map((m) => m[1]);
			facts.push(expectEq(errors, `${path} SSR labels`, labels, Array(n).fill(SPEC.label("neutral"))));
		}
		return { errors, facts };
	}),

	check("logo-sync", "Mark plate and neutral eyes match public/logo.svg", async () => {
		const errors = [];
		const svg = await (await fetch(`${BASE}/logo.svg`)).text();
		// logo.svg repeats the screen path inside <defs> as its clip; compare what is drawn.
		const drawn = [...svg.split("</defs>")[1].matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
		const page = await open("/design", { reduced: true });
		const mark = await page.eval(() =>
			[...window.__vb.marks()[0].querySelectorAll("svg > g > path")].map((p) => p.getAttribute("d")),
		);
		const eyes = await page.eval(() =>
			[...window.__vb.marks()[0].querySelectorAll("svg > g > g[clip-path]")[1].querySelectorAll("path")]
				.slice(0, 2)
				.map((p) => p.getAttribute("d"))
				.join(""),
		);
		const facts = [
			expectEq(errors, "shadow, plate, rim, bezel, screen", mark.slice(0, 5), drawn.slice(0, 5)),
			expectEq(errors, "neutral eyes", eyes, drawn.at(-1)),
		];
		return { errors, facts };
	}),

	check("mood-cycle", "Clicks cycle all nine moods in order and wrap; each glyph matches baseline", async () => {
		const errors = [];
		const facts = [];
		const page = await open("/design", { reduced: true });
		const seen = [];
		const markup = {};
		const r = await page.eval(() => window.__vb.rect(0));
		for (let i = 0; i <= SPEC.order.length; i++) {
			const m = mood((await moods(page))[0]);
			seen.push(m);
			if (i === SPEC.order.length) break;
			markup[m] = await page.eval(() => window.__vb.markup(0));
			await page.screenshot(join(OUT, `mood-${i}-${m}.png`), {
				x: r.x - 12,
				y: r.y - 12,
				width: r.width + 24,
				height: r.height + 24,
			});
			await click(page);
			const want = SPEC.order[(i + 1) % SPEC.order.length];
			await waitFor(async () => mood((await moods(page))[0]) === want, 1000);
		}
		facts.push(expectEq(errors, "mood sequence", seen, [...SPEC.order, SPEC.order[0]]));
		facts.push(
			expectEq(errors, "stored after full cycle", await page.eval((k) => localStorage.getItem(k), SPEC.storageKey), '"neutral"'),
		);
		writeFileSync(join(OUT, "moods.json"), JSON.stringify(markup, null, "\t"));
		if (flag("update-baseline")) {
			mkdirSync(dirname(BASELINE), { recursive: true });
			writeFileSync(BASELINE, `${JSON.stringify(markup, null, "\t")}\n`);
			facts.push({ name: "baseline", note: `rewrote ${BASELINE}`, ok: true });
		} else if (!existsSync(BASELINE)) {
			errors.push(`No baseline at ${BASELINE}. Run with --update-baseline once, with the user's approval.`);
		} else {
			const base = JSON.parse(readFileSync(BASELINE, "utf8"));
			for (const m of SPEC.order) {
				const a = markup[m] ?? "";
				const b = base[m] ?? "";
				const ok = a === b;
				if (!ok) {
					let k = 0;
					while (k < Math.min(a.length, b.length) && a[k] === b[k]) k++;
					errors.push(
						`${m} glyph drifted at char ${k}:\n  baseline …${b.slice(Math.max(0, k - 60), k + 80)}\n  current  …${a.slice(Math.max(0, k - 60), k + 80)}`,
					);
				}
				facts.push({ name: `${m} markup`, sha: createHash("sha256").update(a).digest("hex").slice(0, 12), ok });
			}
		}
		return { errors, facts };
	}),

	check("persist-reload", "Mood survives a reload through localStorage", async () => {
		const errors = [];
		const facts = [];
		const page = await open("/design");
		await click(page);
		await waitFor(async () => mood((await moods(page))[0]) === "happy");
		await sleep(450);
		await click(page);
		await waitFor(async () => mood((await moods(page))[0]) === "love");
		facts.push(expectEq(errors, "stored value", await page.eval((k) => localStorage.getItem(k), SPEC.storageKey), '"love"'));
		await page.reload();
		await hydrated(page);
		const restored = await waitFor(async () => mood((await moods(page))[0]) === "love", 3000);
		facts.push(expectEq(errors, "mood after reload", mood((await moods(page))[0]), "love"));
		if (restored !== true) errors.push("Mood did not restore within 3s of hydration.");
		await page.screenshot(join(OUT, "persist-after-reload.png"));
		return { errors, facts };
	}),

	check("stale-storage", "Unknown or corrupt stored values fall back to neutral", async () => {
		const errors = [];
		const facts = [];
		const page = await open("/design");
		for (const value of ['"bogus"', "not json{", '{"mood":"happy"}']) {
			await page.eval((k, v) => localStorage.setItem(k, v), SPEC.storageKey, value);
			await page.reload();
			await hydrated(page);
			await sleep(300);
			facts.push(expectEq(errors, `mood with stored ${value}`, mood((await moods(page))[0]), "neutral"));
		}
		await click(page);
		await waitFor(async () => mood((await moods(page))[0]) === "happy");
		facts.push(expectEq(errors, "first click from stale value", mood((await moods(page))[0]), "happy"));
		facts.push(
			expectEq(errors, "stored after click", await page.eval((k) => localStorage.getItem(k), SPEC.storageKey), '"happy"'),
		);
		return { errors, facts };
	}),

	check("shared-marks", "Every mark on a page shares one mood", async () => {
		const errors = [];
		const facts = [];
		const page = await open("/design/auth");
		facts.push(expectEq(errors, "mark count", await page.eval(() => window.__vb.count()), SPEC.marksOnAuthDesigns));
		await click(page, 0);
		await waitFor(async () => (await moods(page)).every((l) => mood(l) === "happy"));
		facts.push(
			expectEq(errors, "all marks after one click", (await moods(page)).map(mood), Array(SPEC.marksOnAuthDesigns).fill("happy")),
		);
		await page.screenshot(join(OUT, "shared-marks.png"));
		return { errors, facts };
	}),

	check("cross-tab", "A mood change reaches another open tab without reload", async () => {
		const errors = [];
		const facts = [];
		const a = await open("/design");
		const b = await open("/design", { context: a.ctx });
		await click(a);
		const synced = await waitFor(async () => mood((await moods(b))[0]) === "happy", 2000);
		facts.push(expectEq(errors, "other tab mood", mood((await moods(b))[0]), "happy"));
		if (synced !== true) errors.push("Second tab did not update within 2s.");
		return { errors, facts };
	}),

	check("idle-life", "Untouched mark: breath, sway, glances, lean and blinks replay exactly", async () => {
		const errors = [];
		const facts = [];
		const page = await open("/design");
		const frames = await record(page, 9000);
		saveFrames("idle-life", frames);
		const live = frames.filter((f) => f.body && f.eyes);
		facts.push(expectEq(errors, "transforms parse every frame", live.length, frames.length));
		if (live.length < frames.length) {
			const bad = frames.find((f) => !f.body || !f.eyes);
			errors.push(`Unparsed transform: body="${bad.bodyRaw}" eyes="${bad.eyesRaw}"`);
		}
		if (live.length < 60) return { errors, facts };
		const rows = analyze(frames);
		facts.push(expectEq(errors, "bloom carries the eye transform", live.every((f) => f.bloomRaw === f.eyesRaw), true));
		facts.push(expectIn(errors, "breath residual", maxRes(rows, "breath"), 0, EXACT));
		facts.push(expectIn(errors, "squash at rest (max |s − 1|)", Math.max(...rows.map((r) => Math.abs(r.squash - 1))), 0, EXACT));
		facts.push(expectIn(errors, "rotate = 4·lean residual", maxRes(rows, "rotate"), 0, EXACT));
		facts.push(expectIn(errors, "eye sx sphere residual", maxRes(rows, "eyeSx"), 0, EXACT));
		facts.push(expectIn(errors, "lean x spring residual", maxRes(rows, "leanX"), 0, 1e-7));
		facts.push(expectIn(errors, "lean y spring residual", leanYResiduals(rows, frames), 0, 1e-7));
		// Idle gaze = glance + sway: the glance must be piecewise constant, in range, and change on schedule.
		const changes = [];
		for (let i = 2; i < rows.length; i++) {
			const a = rows[i - 1];
			const b = rows[i];
			if (Math.hypot(b.glanceX - a.glanceX, b.glanceY - a.glanceY) > 1e-7) changes.push(i);
		}
		const plateaus = rows.slice(1).filter((_, i) => !changes.includes(i + 1));
		const gx = plateaus.map((r) => r.glanceX);
		const gy = plateaus.map((r) => r.glanceY);
		const R = MODEL.glanceRange;
		facts.push(expectIn(errors, "glance x range", Math.min(...gx), R.x[0] - 1e-7, R.x[1]));
		facts.push(expectIn(errors, "glance x range (max)", Math.max(...gx), R.x[0], R.x[1] + 1e-7));
		facts.push(expectIn(errors, "glance y range", Math.min(...gy), R.y[0] - 1e-7, R.y[1]));
		facts.push(expectIn(errors, "glance y range (max)", Math.max(...gy), R.y[0], R.y[1] + 1e-7));
		facts.push(expectIn(errors, "glance changes in 9s", changes.length, 2, 7));
		const maxDt = Math.max(...rows.slice(1).map((r) => r.dt * 1000));
		for (let n = 1; n < changes.length; n++) {
			const gap = rows[changes[n]].t - rows[changes[n - 1]].t;
			const held = rows[changes[n - 1]];
			// 30% of picks are the centre, so a centre glance can be picked again unseen and hold longer.
			const centre = Math.hypot(held.glanceX, held.glanceY) < 1e-7;
			const most = centre ? Infinity : MODEL.glanceEvery[1] + maxDt;
			facts.push(expectIn(errors, `glance hold ${n}${centre ? " (centre)" : ""} (ms)`, gap, MODEL.glanceEvery[0], most));
		}
		// Blinks: every frame of each blink matches the lid curve from one start time.
		const blinks = blinksOf(rows);
		facts.push(expectIn(errors, "blinks in 9s", blinks.length, 1, 8));
		const changeTimes = changes.map((i) => rows[i].t);
		blinks.forEach((b, n) => {
			facts.push(expectIn(errors, `blink ${n} lid curve residual`, b.worst, 0, 1e-6));
			// Idle blinks start on a tick, so the start is a frame timestamp.
			// Its start frame was recorded unless the blink was already running when recording began.
			if (b.start >= rows[0].t) {
				const onFrame = Math.min(...rows.map((r) => Math.abs(r.t - b.start)));
				facts.push(expectIn(errors, `blink ${n} starts on a frame (ms off)`, onFrame, 0, 1e-3));
			}
			if (n > 0) {
				const gap = b.start - blinks[n - 1].start;
				const scheduled = gap >= MODEL.blinkEvery[0] && gap <= MODEL.blinkEvery[1] + maxDt;
				const double = gap >= MODEL.doubleBlinkGap[0] && gap <= MODEL.doubleBlinkGap[1] + maxDt;
				const glance = changeTimes.some((t) => Math.abs(t - b.start) < 1e-3);
				const ok = scheduled || double || glance;
				if (!ok) errors.push(`blink ${n}: gap ${gap.toFixed(1)}ms is neither scheduled (3.5–7s), a double blink (360–420ms), nor on a glance`);
				facts.push({ name: `blink ${n} cause`, actual: scheduled ? "scheduled" : double ? "double" : glance ? "glance" : "none", ok });
			}
		});
		return { errors, facts };
	}),

	check("gaze", "Eyes and lean replay exactly toward the pointer; idle resumes 2.5s after the last move", async () => {
		const errors = [];
		const facts = [];
		const page = await open("/design");
		const r = await page.eval(() => window.__vb.rect(0));
		const vp = await page.eval(() => [innerWidth, innerHeight]);
		const targets = [
			["right", 600, 0],
			["up-left", -250, -250],
			["down", 0, 250],
		];
		for (const [name, dx, dy] of targets) {
			const [px, py] = [Math.round(r.cx + dx), Math.round(r.cy + dy)];
			if (px < 0 || py < 0 || px > vp[0] || py > vp[1]) {
				errors.push(`Precondition: ${name} target (${px}, ${py}) is outside the ${vp.join("×")} viewport; the mark moved.`);
				continue;
			}
			const frames = await record(page, 900, async () => {
				await sleep(100);
				await page.mouse("mouseMoved", px, py);
			});
			saveFrames(`gaze-${name}`, frames);
			const ev = (await events(page)).findLast((e) => e.type === "pointermove");
			const want = MODEL.gaze(ev.x - r.cx, ev.y - r.cy);
			const rows = analyze(frames);
			const tracking = rows.filter((row) => row.gx !== undefined && row.t >= ev.at - 34);
			const first = tracking.findIndex((row) => Math.abs(row.gx - want.x) < EXACT && Math.abs(row.gy - want.y) < EXACT);
			if (first < 0) {
				errors.push(`${name}: eyes never aimed at the pointer's gaze (${want.x.toFixed(4)}, ${want.y.toFixed(4)})`);
				continue;
			}
			const aimed = tracking.slice(first);
			facts.push(expectIn(errors, `${name} gaze switches within a frame of the move (ms)`, aimed[0].t - ev.at, -34, 34));
			facts.push(
				expectIn(errors, `${name} gaze held every frame after`, Math.max(...aimed.map((x) => Math.hypot(x.gx - want.x, x.gy - want.y))), 0, EXACT),
			);
			facts.push(expectIn(errors, `${name} lean x spring residual`, maxRes(rows, "leanX"), 0, 1e-7));
			facts.push(expectIn(errors, `${name} lean y spring residual`, leanYResiduals(rows, frames), 0, 1e-7));
			facts.push(expectIn(errors, `${name} eye sx sphere residual`, maxRes(rows, "eyeSx"), 0, EXACT));
			const end = frames.at(-1);
			facts.push(expectNear(errors, `${name} settled eye x`, end.eyes.x, MODEL.eyeX(MODEL.yaw(want.x)), 1e-6));
			facts.push(expectNear(errors, `${name} settled eye y`, end.eyes.y, MODEL.eyeY(MODEL.pitch(want.y)), 1e-6));
			facts.push(expectNear(errors, `${name} settled body rotate`, end.body.r, MODEL.rotate(want.x), 5e-3));
		}
		// Hold still past IDLE_AFTER_MS: gaze stays put, then glances and sway take over.
		const frames = await record(page, 3300, async () => {
			await sleep(50);
			await page.mouse("mouseMoved", Math.round(r.cx + 600), Math.round(r.cy));
		});
		saveFrames("gaze-idle-return", frames);
		const ev = (await events(page)).findLast((e) => e.type === "pointermove");
		const want = MODEL.gaze(ev.x - r.cx, ev.y - r.cy);
		const rows = analyze(frames).filter((row) => row.gx !== undefined && row.t > ev.at + 34);
		const held = rows.filter((row) => row.t - ev.stamp <= MODEL.idleAfter);
		const idle = rows.filter((row) => row.t - ev.stamp > MODEL.idleAfter);
		facts.push(
			expectIn(errors, "gaze held until idle", Math.max(...held.map((x) => Math.hypot(x.gx - want.x, x.gy - want.y))), 0, EXACT),
		);
		facts.push(expectEq(errors, "first idle frame leaves the pointer", idle.length > 0 && Math.hypot(idle[0].gx - want.x, idle[0].gy - want.y) > 1e-6, true));
		return { errors, facts };
	}),

	check("press-hop", "Press, release, hop, stretch and the mid-blink mood swap replay exactly", async () => {
		const errors = [];
		const facts = [];
		const page = await open("/design");
		const r = await page.eval(() => window.__vb.rect(0));
		const [cx, cy] = [Math.round(r.cx), Math.round(r.cy)];
		await page.mouse("mouseMoved", cx, cy);
		await sleep(500);
		// Everything below must finish inside IDLE_AFTER_MS of that move, or glances move the lean.
		const frames = await record(page, 650, async () => {
			await sleep(100);
			await page.mouse("mousePressed", cx, cy);
			await sleep(550);
			await page.mouse("mouseReleased", cx, cy);
		});
		saveFrames("press-hop", frames);
		const ev = await events(page);
		const down = ev.findLast((e) => e.type === "pointerdown");
		const up = ev.findLast((e) => e.type === "pointerup");
		const clickEv = ev.findLast((e) => e.type === "click");
		const move = ev.findLast((e) => e.type === "pointermove");
		if (frames.at(-1).t - move.stamp > MODEL.idleAfter) errors.push("Precondition: recording outlived the pointer's idle window; rerun on a quieter machine.");
		const rows = analyze(frames);
		const f = frames.filter((x) => x.body && x.eyes);
		facts.push(expectIn(errors, "breath residual (squash separated)", maxRes(rows, "breath"), 0, EXACT));

		// Replay squash and hop. The press lands between two frames; so does the release.
		const sq = { x: 1, v: 0 };
		const hop = { x: 0, v: 0 };
		const ly0 = (f[0].body.y - MODEL.float(f[0].t / 1000)) / 1.5;
		let lean = { x: ly0, v: 0 };
		let target = 1;
		let pressedAt;
		let releasedAt;
		let worstSq = 0;
		let worstY = 0;
		const replay = [];
		for (let i = 1; i < f.length; i++) {
			const dt = rows[i].dt;
			const tryStep = (state) => {
				const s = { ...state.sq };
				const h = { ...state.hop };
				if (state.release) {
					s.v = MODEL.squash.kick;
					h.v = MODEL.hop.kick;
				}
				MODEL.spring(s, state.target, MODEL.squash.stiffness, MODEL.squash.damping, dt);
				MODEL.spring(h, 0, MODEL.hop.stiffness, MODEL.hop.damping, dt);
				return { s, h, err: Math.abs(s.x - rows[i].squash) };
			};
			let step = tryStep({ sq, hop, target, release: false });
			if (step.err > EXACT && pressedAt === undefined) {
				const pressed = tryStep({ sq, hop, target: MODEL.squash.pressed, release: false });
				if (pressed.err <= EXACT) {
					target = MODEL.squash.pressed;
					pressedAt = f[i].t;
					step = pressed;
				}
			} else if (step.err > EXACT && pressedAt !== undefined && releasedAt === undefined) {
				const released = tryStep({ sq, hop, target: 1, release: true });
				if (released.err <= EXACT) {
					target = 1;
					releasedAt = f[i].t;
					step = released;
				}
			}
			sq.x = step.s.x;
			sq.v = step.s.v;
			hop.x = step.h.x;
			hop.v = step.h.v;
			worstSq = Math.max(worstSq, step.err);
			MODEL.spring(lean, rows[i].gy, MODEL.lean.stiffness, MODEL.lean.damping, dt);
			worstY = Math.max(worstY, Math.abs(f[i].body.y - MODEL.bodyY(lean.x, f[i].t / 1000, hop.x)));
			replay.push({ t: f[i].t, dt, squash: rows[i].squash, sqErr: step.err, hop: hop.x, yErr: f[i].body.y - MODEL.bodyY(lean.x, f[i].t / 1000, hop.x), gy: rows[i].gy });
			if (releasedAt === undefined) {
				// No hop yet, so y gives the lean exactly; resync to it so the replay starts from the true state.
				const ly = (f[i].body.y - MODEL.float(f[i].t / 1000)) / 1.5;
				const prev = (f[i - 1].body.y - MODEL.float(f[i - 1].t / 1000)) / 1.5;
				lean = i > 1 ? { x: ly, v: (ly - prev) / dt } : { x: ly, v: 0 };
				// The first two frames only seed the lean's position and velocity.
				if (i <= 2) worstY = 0;
			}
		}
		writeFileSync(join(OUT, "replay-press-hop.json"), JSON.stringify({ pressedAt, releasedAt, replay }, null, 1));
		facts.push(expectIn(errors, "squash replay residual", worstSq, 0, EXACT));
		facts.push(expectIn(errors, "hop (body y) replay residual", worstY, 0, 1e-6));
		facts.push(expectIn(errors, "press lands within a frame of pointerdown (ms)", (pressedAt ?? Infinity) - down.at, -34, 34));
		facts.push(expectIn(errors, "release lands within a frame of click (ms)", (releasedAt ?? Infinity) - clickEv.at, -34, 34));
		const squashes = rows.map((x) => x.squash);
		facts.push({ name: "squash min / stretch max", actual: [Math.min(...squashes), Math.max(...squashes)], ok: true });
		facts.push({ name: "hop apex (viewBox units)", actual: Math.min(...f.map((x, i) => x.body.y - MODEL.bodyY(ly0, x.t / 1000, 0))), ok: true });

		// The glyph swaps on the blink that carries the click, once its eyes are shut.
		// A click mid-blink takes one of the app's two other paths, so identify which.
		const blinks = blinksOf(rows);
		const swapAt = f.findIndex((x) => x.eyeD !== f[0].eyeD);
		if (swapAt < 0) {
			errors.push("Eyes never changed glyph after the click.");
			return { errors, facts };
		}
		const carrier = blinks.findLast((b) => b.start <= f[swapAt].t);
		if (!carrier) {
			errors.push("The glyph changed outside any blink.");
			return { errors, facts };
		}
		const B = MODEL.blink;
		const total = B.close + B.hold + B.open;
		const before = blinks.findLast((b) => b.start < clickEv.at - 2);
		const sinceBefore = before ? clickEv.at - before.start : Infinity;
		let path;
		if (Math.abs(carrier.start - clickEv.at) <= 2) path = "direct";
		else if (carrier === before && sinceBefore < B.close) path = "joined closing blink";
		else if (before && carrier !== before && sinceBefore < total) {
			// Queued: the new blink starts on the first tick at or after the running one ends.
			const end = rows.find((r) => r.t - before.start >= total)?.t;
			path = Math.abs(carrier.start - end) < 1e-3 ? "queued behind running blink" : undefined;
		}
		facts.push({ name: "click blink path", actual: path ?? "none", ok: Boolean(path) });
		if (!path) {
			errors.push(
				`Click blink fits no path: click at ${clickEv.at.toFixed(1)}, carrier starts ${carrier.start.toFixed(1)}, previous blink ${before ? before.start.toFixed(1) : "none"}`,
			);
		}
		facts.push(expectIn(errors, "click blink lid curve residual", carrier.worst, 0, 1e-6));
		const closedAt = f.findIndex((x) => x.t - carrier.start >= B.close);
		facts.push(expectIn(errors, "glyph swaps on the first shut frame (frames late)", swapAt - closedAt, 0, 1));
		facts.push(expectIn(errors, "lid at glyph swap", rows[swapAt].lid, 0.1 - EXACT, 0.15));
		facts.push(expectEq(errors, "label at swap", mood(f[swapAt].label), "happy"));
		facts.push(expectEq(errors, "label before swap", mood(f[swapAt - 1].label), "neutral"));
		return { errors, facts };
	}),

	check("press-cancel", "Pressing then dragging off the mark cancels: squash returns, mood unchanged", async () => {
		const errors = [];
		const facts = [];
		const page = await open("/design");
		const r = await page.eval(() => window.__vb.rect(0));
		const [cx, cy] = [Math.round(r.cx), Math.round(r.cy)];
		await page.mouse("mouseMoved", cx, cy);
		await page.mouse("mousePressed", cx, cy);
		await sleep(400);
		const pressed = await page.eval(() => window.__vb.read(0));
		await page.mouse("mouseMoved", cx + 300, cy, { buttons: 1, button: "left" });
		await sleep(800);
		const after = await page.eval(() => window.__vb.read(0));
		await page.mouse("mouseReleased", cx + 300, cy);
		await sleep(400);
		const s = (b) => (2 * b.sy) / (b.sx + b.sy);
		facts.push(expectNear(errors, "squash while pressed", s(pressed.body), MODEL.squash.pressed, 0.01));
		facts.push(expectNear(errors, "squash after leaving", s(after.body), 1, 1e-3));
		facts.push(expectEq(errors, "mood", mood((await moods(page))[0]), "neutral"));
		return { errors, facts };
	}),

	check("reduced-motion", "Reduced motion: no transforms, immediate mood swap", async () => {
		const errors = [];
		const facts = [];
		const page = await open("/design", { reduced: true });
		await sleep(600);
		const s = await page.eval(() => window.__vb.read(0));
		facts.push(expectEq(errors, "transforms", [s.bodyRaw, s.eyesRaw, s.bloomRaw], [null, null, null]));
		const frames = await record(page, 300, () => click(page));
		const clickEv = (await events(page)).findLast((e) => e.type === "click");
		const swap = frames.find((f) => mood(f.label) === "happy");
		facts.push(expectIn(errors, "label swap after click (ms)", swap ? swap.t - clickEv.at : Infinity, -34, 34));
		facts.push(expectEq(errors, "transforms after click", frames.some((f) => f.bodyRaw || f.eyesRaw), false));
		return { errors, facts };
	}),

	check("offscreen-pause", "Animation stops while the mark is scrolled out of view and resumes on return", async () => {
		const errors = [];
		const facts = [];
		const page = await open("/design");
		const room = await page.eval(() => document.documentElement.scrollHeight - innerHeight);
		const r = await page.eval(() => window.__vb.rect(0));
		const dy = Math.ceil(r.y + r.height + 400);
		if (room < dy) {
			errors.push(`Precondition: /design scrolls only ${room}px; the mark cannot leave the viewport.`);
			return { errors, facts };
		}
		await page.mouse("mouseWheel", 640, 450, { deltaX: 0, deltaY: dy });
		await waitFor(async () => (await page.eval(() => window.__vb.rect(0).y + window.__vb.rect(0).height)) < 0, 2000);
		await sleep(300);
		const a = (await page.eval(() => window.__vb.read(0))).bodyRaw;
		await sleep(1200);
		const b = (await page.eval(() => window.__vb.read(0))).bodyRaw;
		facts.push(expectEq(errors, "body transform frozen offscreen", a === b, true));
		await page.mouse("mouseWheel", 640, 450, { deltaX: 0, deltaY: -dy });
		await waitFor(async () => (await page.eval(() => window.__vb.rect(0).y)) >= 0, 2000);
		await sleep(200);
		const c = (await page.eval(() => window.__vb.read(0))).bodyRaw;
		await sleep(300);
		const d = (await page.eval(() => window.__vb.read(0))).bodyRaw;
		facts.push(expectEq(errors, "body transform moving on return", c !== d, true));
		return { errors, facts };
	}),
];

// ---------------------------------------------------------------- run

const selected = ONLY ? CHECKS.filter((c) => ONLY.includes(c.id)) : CHECKS;
if (ONLY && selected.length !== ONLY.length) {
	console.error(`Unknown check id. Known: ${CHECKS.map((c) => c.id).join(", ")}`);
	process.exit(2);
}

try {
	const res = await fetch(`${BASE}/design`);
	if (!res.ok) throw new Error(`GET /design → ${res.status}`);
} catch (e) {
	console.error(`App not reachable at ${BASE}: ${e.message}. Run brand.sh up first.`);
	process.exit(2);
}

const results = [];
browser = await launch({ headed: flag("headed") });
let crashed = false;
try {
	for (const c of selected) {
		const started = Date.now();
		let out;
		try {
			out = await c.run();
		} catch (e) {
			out = { errors: [`threw: ${e.stack ?? e}`], facts: [] };
		}
		await closeAll();
		const pass = out.errors.length === 0;
		results.push({ id: c.id, title: c.title, pass, ms: Date.now() - started, ...out });
		console.log(`${pass ? "PASS" : "FAIL"}  ${c.id.padEnd(16)} ${c.title}`);
		for (const e of out.errors) console.log(`      ${e.replaceAll("\n", "\n      ")}`);
	}
} catch (e) {
	crashed = true;
	console.error(e);
} finally {
	await browser.close();
}

const failed = results.filter((r) => !r.pass);
writeFileSync(join(OUT, "report.json"), JSON.stringify({ base: BASE, at: stamp, spec: SPEC, results }, null, "\t"));
const md = [
	`# verify-brand ${stamp}`,
	"",
	`Base: ${BASE}. ${results.length - failed.length}/${results.length} checks passed.`,
	"",
	...results.flatMap((r) => [
		`## ${r.pass ? "PASS" : "FAIL"} ${r.id}`,
		"",
		r.title,
		"",
		...r.facts.map((f) => `- ${f.ok ? "ok" : "**FAIL**"} ${f.name}: ${JSON.stringify(f.actual ?? f.sha ?? f.note)}`),
		...r.errors.map((e) => `- error: ${e}`),
		"",
	]),
].join("\n");
writeFileSync(join(OUT, "report.md"), md);
console.log(`\n${results.length - failed.length}/${results.length} passed. Evidence: ${OUT}`);
process.exit(crashed ? 2 : failed.length ? 1 : 0);
