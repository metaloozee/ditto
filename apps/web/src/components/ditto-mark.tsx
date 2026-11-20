import { cn } from "cn";
import * as React from "react";

// Path data mirrors public/logo.svg; keep the two in sync.
const SHADOW =
	"M50 9.9C55.37 9.9 60.82 9.85 66.71 10.57C72.6 11.28 79.04 12.88 84.3 16.6C89.56 20.32 93.05 26.23 94.56 32.44C96.06 38.65 96 44.88 96 50.9C96 56.92 96.06 63.15 94.56 69.36C93.05 75.57 89.56 81.48 84.3 85.2C79.04 88.92 72.6 90.52 66.71 91.23C60.82 91.95 55.37 91.9 50 91.9C44.63 91.9 39.18 91.95 33.29 91.23C27.4 90.52 20.96 88.92 15.7 85.2C10.44 81.48 6.95 75.57 5.44 69.36C3.94 63.15 4 56.92 4 50.9C4 44.88 3.94 38.65 5.44 32.44C6.95 26.23 10.44 20.32 15.7 16.6C20.96 12.88 27.4 11.28 33.29 10.57C39.18 9.85 44.63 9.9 50 9.9Z";
const PLATE =
	"M50 8.3C55.37 8.3 60.82 8.25 66.71 8.97C72.6 9.68 79.04 11.28 84.3 15C89.56 18.72 93.05 24.63 94.56 30.84C96.06 37.05 96 43.28 96 49.3C96 55.32 96.06 61.55 94.56 67.76C93.05 73.97 89.56 79.88 84.3 83.6C79.04 87.32 72.6 88.92 66.71 89.63C60.82 90.35 55.37 90.3 50 90.3C44.63 90.3 39.18 90.35 33.29 89.63C27.4 88.92 20.96 87.32 15.7 83.6C10.44 79.88 6.95 73.97 5.44 67.76C3.94 61.55 4 55.32 4 49.3C4 43.28 3.94 37.05 5.44 30.84C6.95 24.63 10.44 18.72 15.7 15C20.96 11.28 27.4 9.68 33.29 8.97C39.18 8.25 44.63 8.3 50 8.3Z";
const RIM =
	"M50 8.55C55.33 8.55 60.75 8.5 66.61 9.21C72.46 9.92 78.87 11.5 84.1 15.2C89.33 18.9 92.81 24.77 94.31 30.95C95.81 37.12 95.75 43.31 95.75 49.3C95.75 55.29 95.81 61.48 94.31 67.65C92.81 73.83 89.33 79.7 84.1 83.4C78.87 87.1 72.46 88.68 66.61 89.39C60.75 90.1 55.33 90.05 50 90.05C44.67 90.05 39.25 90.1 33.39 89.39C27.54 88.68 21.13 87.1 15.9 83.4C10.67 79.7 7.19 73.83 5.69 67.65C4.19 61.48 4.25 55.29 4.25 49.3C4.25 43.31 4.19 37.12 5.69 30.95C7.19 24.77 10.67 18.9 15.9 15.2C21.13 11.5 27.54 9.92 33.39 9.21C39.25 8.5 44.67 8.55 50 8.55Z";
const BEZEL =
	"M50 16.3C54.32 16.3 58.71 16.3 63.4 16.95C68.09 17.6 73.16 18.95 77.46 21.84C81.75 24.74 84.92 29.25 86.43 34.21C87.93 39.17 88 44.33 88 49.3C88 54.27 87.93 59.43 86.43 64.39C84.92 69.35 81.75 73.86 77.46 76.76C73.16 79.65 68.09 81 63.4 81.65C58.71 82.3 54.32 82.3 50 82.3C45.68 82.3 41.29 82.3 36.6 81.65C31.91 81 26.84 79.65 22.54 76.76C18.25 73.86 15.08 69.35 13.57 64.39C12.07 59.43 12 54.27 12 49.3C12 44.33 12.07 39.17 13.57 34.21C15.08 29.25 18.25 24.74 22.54 21.84C26.84 18.95 31.91 17.6 36.6 16.95C41.29 16.3 45.68 16.3 50 16.3Z";
const SCREEN =
	"M50 17.8C54.12 17.8 58.31 17.8 62.8 18.41C67.28 19.02 72.13 20.29 76.27 23.03C80.41 25.77 83.49 30.06 84.96 34.82C86.43 39.57 86.5 44.52 86.5 49.3C86.5 54.08 86.43 59.03 84.96 63.78C83.49 68.54 80.41 72.83 76.27 75.57C72.13 78.31 67.28 79.58 62.8 80.19C58.31 80.8 54.12 80.8 50 80.8C45.88 80.8 41.69 80.8 37.2 80.19C32.72 79.58 27.87 78.31 23.73 75.57C19.59 72.83 16.51 68.54 15.04 63.78C13.57 59.03 13.5 54.08 13.5 49.3C13.5 44.52 13.57 39.57 15.04 34.82C16.51 30.06 19.59 25.77 23.73 23.03C27.87 20.29 32.72 19.02 37.2 18.41C41.69 17.8 45.88 17.8 50 17.8Z";

const heart = (x: number, y: number, r = 1.25) =>
	`M${x} ${y + 7 * r}C${x - 9 * r} ${y + r} ${x - 8 * r} ${y - 7 * r} ${x - 4 * r} ${y - 7 * r}C${x - 1.5 * r} ${y - 7 * r} ${x} ${y - 5 * r} ${x} ${y - 3.5 * r}C${x} ${y - 5 * r} ${x + 1.5 * r} ${y - 7 * r} ${x + 4 * r} ${y - 7 * r}C${x + 8 * r} ${y - 7 * r} ${x + 9 * r} ${y + r} ${x} ${y + 7 * r}Z`;

/**
 * Each mood is one path per eye, drawn with the logo's stroke. `weight` scales
 * the stroke for shapes that would clog at full width; `fill` closes them.
 */
type MoodShape = { eyes: readonly string[]; weight?: number; fill?: boolean };

const MOODS = {
	neutral: { eyes: ["M42.2 39.8L33.8 58.8", "M66.2 39.8L57.8 58.8"] },
	happy: { eyes: ["M28 54C30 45 40 45 42 54", "M58 54C60 45 70 45 72 54"] },
	love: { eyes: [heart(35, 49), heart(65, 49)], weight: 0.4, fill: true },
	surprised: { eyes: ["M38 39L38 59.6", "M62 39L62 59.6"] },
	wink: { eyes: ["M38 40L38 59", "M57 52C59 45 68 45 70 52"] },
	angry: { eyes: ["M31 42L42 50", "M69 42L58 50"] },
	sad: { eyes: ["M31 53L42 47", "M69 53L58 47"] },
	dizzy: { eyes: ["M30 43L42 55M42 43L30 55", "M58 43L70 55M70 43L58 55"], weight: 0.6 },
	sleepy: { eyes: ["M29 54L43 54", "M57 54L71 54"] },
} satisfies Record<string, MoodShape>;

type Mood = keyof typeof MOODS;
const ORDER = Object.keys(MOODS) as Mood[];

const FACE_CENTER = { x: 50, y: 49.3 };
// A blink shuts fast, rests shut for a beat, then opens slower than it closed.
const BLINK = { close: 90, hold: 50, open: 140 };
const BLINK_MS = BLINK.close + BLINK.hold + BLINK.open;
const nextBlinkIn = () => random(3500, 7000);
const IDLE_AFTER_MS = 2500;

const random = (min: number, max: number) => min + Math.random() * (max - min);

type Spring = { x: number; v: number };
const spring = (x = 0): Spring => ({ x, v: 0 });

function stepSpring(s: Spring, target: number, stiffness: number, damping: number, dt: number) {
	s.v += (stiffness * (target - s.x) - damping * s.v) * dt;
	s.x += s.v * dt;
}

/**
 * One loop drives the whole character. Eyes snap to the gaze in ~60ms (an
 * exponential ease that never overshoots, like a saccade); the body follows
 * the same gaze on a looser spring, so it leans a beat late. Eye offsets are
 * projected onto a sphere behind the screen: they narrow as they turn toward
 * an edge instead of sliding flat. Breath (1.2% on a 3.4s cycle) and glances
 * (every 1.5–4s when left alone) follow the avatar skill; blinks are slower
 * and sparser than its measured ones so they stay a background detail.
 */
function createDitto() {
	const gaze = { x: 0, y: 0 };
	const eye = { x: 0, y: 0 };
	const lean = { x: spring(), y: spring() };
	const hop = spring();
	const squash = spring(1);
	let squashTarget = 1;

	let pointerAt = Number.NEGATIVE_INFINITY;
	let glance = { x: 0, y: 0 };
	let nextGlance = 0;
	let nextBlink = random(1500, 3000);
	let blinkStart = Number.NEGATIVE_INFINITY;
	let onClosed: (() => void) | undefined;
	let queued: (() => void) | undefined;

	function blink(now: number, then?: () => void) {
		if (now - blinkStart < BLINK_MS) {
			// Mid-blink: run it now if the eyes haven't closed yet, else blink again.
			if (now - blinkStart < BLINK.close && !onClosed) onClosed = then;
			else queued = then;
			return;
		}
		blinkStart = now;
		onClosed = then;
		nextBlink = now + nextBlinkIn();
		if (Math.random() < 0.12) nextBlink = now + BLINK_MS + random(80, 140);
	}

	function lid(now: number) {
		const elapsed = now - blinkStart;
		if (elapsed >= BLINK_MS) {
			if (queued) {
				const then = queued;
				queued = undefined;
				blink(now, then);
				return lid(now);
			}
			return 1;
		}
		if (elapsed < BLINK.close) {
			return 0.1 + 0.9 * ((1 + Math.cos((Math.PI * elapsed) / BLINK.close)) / 2);
		}
		if (onClosed) {
			onClosed();
			onClosed = undefined;
		}
		const opening = elapsed - BLINK.close - BLINK.hold;
		if (opening <= 0) return 0.1;
		return 0.1 + 0.9 * ((1 - Math.cos((Math.PI * opening) / BLINK.open)) / 2);
	}

	return {
		/** dx, dy: pointer offset from the mark's center, in px. */
		look(dx: number, dy: number, now: number) {
			const dist = Math.hypot(dx, dy) || 1;
			// Saturates smoothly: near the mark the eyes track closely, far away they max out.
			const pull = 1 - Math.exp(-dist / 220);
			gaze.x = (dx / dist) * pull;
			gaze.y = (dy / dist) * pull;
			pointerAt = now;
		},
		leave() {
			pointerAt = Number.NEGATIVE_INFINITY;
		},
		press() {
			squashTarget = 0.92;
		},
		cancel() {
			squashTarget = 1;
		},
		release(now: number, then: () => void) {
			squashTarget = 1;
			hop.v = -150;
			squash.v = 3;
			blink(now, then);
		},
		step(now: number, dt: number) {
			const t = now / 1000;
			if (now - pointerAt > IDLE_AFTER_MS) {
				if (now >= nextGlance) {
					const next =
						Math.random() < 0.3 ? { x: 0, y: 0 } : { x: random(-0.6, 0.6), y: random(-0.45, 0.35) };
					if (Math.hypot(next.x - glance.x, next.y - glance.y) > 0.5 && Math.random() < 0.3) {
						blink(now);
					}
					glance = next;
					nextGlance = now + random(1500, 4000);
				}
				gaze.x = glance.x + 0.04 * Math.sin(t * 0.9) + 0.025 * Math.sin(t * 2.3);
				gaze.y = glance.y + 0.03 * Math.sin(t * 1.1 + 1) + 0.02 * Math.sin(t * 2.9);
			}
			if (now >= nextBlink) blink(now);

			const k = 1 - Math.exp(-dt / 0.02);
			eye.x += (gaze.x - eye.x) * k;
			eye.y += (gaze.y - eye.y) * k;
			stepSpring(lean.x, gaze.x, 260, 24, dt);
			stepSpring(lean.y, gaze.y, 260, 24, dt);
			stepSpring(hop, 0, 300, 16, dt);
			stepSpring(squash, squashTarget, 600, 20, dt);

			const yaw = eye.x * (Math.PI / 4);
			const pitch = eye.y * (Math.PI / 5);
			const open = lid(now);
			const breath = 1 + 0.012 * Math.sin((t * 2 * Math.PI) / 3.4);
			const float = 0.6 * Math.sin((t * 2 * Math.PI) / 4.1);

			return {
				eyes: {
					x: 8.5 * Math.sin(yaw),
					y: 7.5 * Math.sin(pitch),
					sx: Math.sqrt(Math.cos(yaw)),
					sy: Math.sqrt(Math.cos(pitch)) * open,
				},
				body: {
					x: lean.x.x * 2.5,
					y: lean.y.x * 1.5 + float + hop.x,
					rotate: lean.x.x * 4,
					sx: breath * (2 - squash.x),
					sy: breath * squash.x,
				},
			};
		},
	};
}

type Ditto = ReturnType<typeof createDitto>;

function Eyes({ mood, width, stroke }: { mood: Mood; width: number; stroke: string }) {
	const { eyes, weight = 1, fill = false }: MoodShape = MOODS[mood];
	return eyes.map((d) => (
		<path
			key={d}
			d={d}
			fill={fill ? stroke : "none"}
			stroke={stroke}
			strokeWidth={width * weight}
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	));
}

function DittoMark({ className, ...props }: Omit<React.ComponentProps<"button">, "onClick">) {
	const [mood, setMood] = React.useState<Mood>("neutral");
	const button = React.useRef<HTMLButtonElement>(null);
	const body = React.useRef<SVGGElement>(null);
	const bloom = React.useRef<SVGGElement>(null);
	const eyes = React.useRef<SVGGElement>(null);
	const ditto = React.useRef<Ditto>(undefined);

	const nextMood = () => setMood((m) => ORDER[(ORDER.indexOf(m) + 1) % ORDER.length]);

	React.useEffect(() => {
		const el = button.current;
		if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const d = createDitto();
		ditto.current = d;

		let frame = 0;
		let last = 0;
		const tick = (now: number) => {
			const dt = Math.min((now - last) / 1000, 0.064);
			last = now;
			const { eyes: e, body: b } = d.step(now, dt);
			const { x: cx, y: cy } = FACE_CENTER;
			const eyeTransform = `translate(${e.x} ${e.y}) translate(${cx} ${cy}) scale(${e.sx} ${e.sy}) translate(${-cx} ${-cy})`;
			eyes.current?.setAttribute("transform", eyeTransform);
			bloom.current?.setAttribute("transform", eyeTransform);
			// Squash and stretch anchor at the base, so a hop lands on its feet.
			body.current?.setAttribute(
				"transform",
				`translate(${b.x} ${b.y}) rotate(${b.rotate} 50 50) translate(50 90) scale(${b.sx} ${b.sy}) translate(-50 -90)`,
			);
			frame = requestAnimationFrame(tick);
		};
		const start = () => {
			if (frame) return;
			last = performance.now();
			frame = requestAnimationFrame(tick);
		};
		const stop = () => {
			cancelAnimationFrame(frame);
			frame = 0;
		};

		const visible = new IntersectionObserver(([entry]) =>
			entry?.isIntersecting ? start() : stop(),
		);
		visible.observe(el);

		const onMove = (e: PointerEvent) => {
			if (e.pointerType === "touch") return;
			const box = el.getBoundingClientRect();
			d.look(
				e.clientX - (box.left + box.width / 2),
				e.clientY - (box.top + box.height / 2),
				e.timeStamp,
			);
		};
		const onLeave = () => d.leave();
		window.addEventListener("pointermove", onMove, { passive: true });
		document.documentElement.addEventListener("pointerleave", onLeave);
		return () => {
			stop();
			visible.disconnect();
			window.removeEventListener("pointermove", onMove);
			document.documentElement.removeEventListener("pointerleave", onLeave);
			ditto.current = undefined;
		};
	}, []);

	// useId can contain characters that break url(#…) references.
	const id = `ditto-${React.useId().replace(/[^\w-]/g, "")}`;
	const url = (name: string) => `url(#${id}-${name})`;

	return (
		<button
			ref={button}
			type="button"
			aria-label={`Ditto, feeling ${mood}. Change mood`}
			onPointerDown={() => ditto.current?.press()}
			// The mood swaps while the eyes are shut, mid-blink.
			onClick={() => {
				const d = ditto.current;
				if (d) d.release(performance.now(), nextMood);
				else nextMood();
			}}
			onPointerLeave={() => ditto.current?.cancel()}
			className={cn(
				"cursor-pointer touch-manipulation rounded-[28%] outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
				className,
			)}
			{...props}
		>
			<svg viewBox="0 0 100 100" overflow="visible" className="size-full" aria-hidden>
				<defs>
					<linearGradient id={`${id}-plate`} x1="0" y1="0" x2="0" y2="1">
						<stop offset="0" stopColor="#ffffff" />
						<stop offset="1" stopColor="#dcdcde" />
					</linearGradient>
					<linearGradient id={`${id}-bezel`} x1="0" y1="0" x2="0" y2="1">
						<stop offset="0" stopColor="#c0c1c3" />
						<stop offset=".6" stopColor="#e8e8ea" />
						<stop offset="1" stopColor="#ffffff" />
					</linearGradient>
					<linearGradient id={`${id}-well`} x1="0" y1="0" x2="0" y2="1">
						<stop offset="0" stopColor="#000" stopOpacity=".5" />
						<stop offset=".35" stopColor="#000" stopOpacity="0" />
					</linearGradient>
					<filter
						id={`${id}-bloom`}
						filterUnits="userSpaceOnUse"
						x="0"
						y="0"
						width="100"
						height="100"
					>
						<feGaussianBlur stdDeviation="3" />
					</filter>
					<clipPath id={`${id}-screen`}>
						<path d={SCREEN} />
					</clipPath>
				</defs>
				<g ref={body}>
					<path d={SHADOW} fill="#b0b1b4" />
					<path d={PLATE} fill={url("plate")} />
					<path d={RIM} fill="none" stroke="#868687" strokeOpacity=".4" strokeWidth=".5" />
					<path d={BEZEL} fill={url("bezel")} />
					<path d={SCREEN} fill="#19191a" />
					<g clipPath={url("screen")}>
						<g filter={url("bloom")} opacity=".7">
							<g ref={bloom}>
								<Eyes mood={mood} width={13} stroke="#5884f8" />
							</g>
						</g>
						<path d={SCREEN} fill={url("well")} />
					</g>
					<g clipPath={url("screen")}>
						<g ref={eyes}>
							<Eyes mood={mood} width={11} stroke="#5884f8" />
							<Eyes mood={mood} width={7.6} stroke="#9fbdff" />
						</g>
					</g>
				</g>
			</svg>
		</button>
	);
}

export { DittoMark };
