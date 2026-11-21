// Adapted from Kobra's toast (kobra.systems), rebuilt on Ditto's tokens: the
// popover surface and ring, `success` and `destructive` as the only tones, a
// loading.dev Ring for pending, HugeIcons marks and Ditto's Button.
import { useDirection } from "@base-ui/react/direction-provider";
import {
	Alert02Icon,
	CheckmarkCircle02Icon,
	InformationCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import { Ring } from "loading-dev";
import {
	animate,
	AnimatePresence,
	cancelFrame,
	frame,
	motion,
	MotionConfig,
	useIsPresent,
	useMotionValue,
	usePresenceData,
	useReducedMotion,
} from "motion/react";
import {
	type ComponentProps,
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";

import { Button } from "#/components/ui/button.tsx";

const EVENT = "ditto:toast";
const DISMISS = "ditto:toast-dismiss";
const LIFETIME = 2400;
const DETAIL_LIFETIME = 5000;
const ACTION_LIFETIME = 6000;
const GAP = 8;
const PEEK = 10;
const SHRINK = 0.03;
const DEPTH = 3;
const FADE = 0.15;
const REACH = 10;
const SWIPE = 44;
const FLICK = 380;
const MORPH = { type: "spring", duration: 0.3, bounce: 0 } as const;
const EXIT = { type: "spring", duration: 0.2, bounce: 0 } as const;
const LINE_HEIGHT = 36;
const CARD_WIDTH = 340;
// The stack's inline padding: a card never runs past the page's 16px margins.
const GUTTERS = 32;

function subscribeResize(onChange: () => void) {
	window.addEventListener("resize", onChange);
	return () => window.removeEventListener("resize", onChange);
}

function useViewportWidth() {
	return useSyncExternalStore(
		subscribeResize,
		() => window.innerWidth,
		() => CARD_WIDTH + GUTTERS,
	);
}

type ToastSide = "top" | "bottom";
type ToastEdge = "start" | "center" | "end";
type ToastPosition = `${ToastSide}-${ToastEdge}`;

const JUSTIFY: Record<ToastEdge, string> = {
	start: "justify-start",
	center: "justify-center",
	end: "justify-end",
};

/** `info` is neutral: Ditto has no second accent hue for it. */
export type ToastState = "pending" | "success" | "error" | "info";
export type ToastAction = { label: string; run: () => void };
export type ToastInput = {
	/** Reusing an id replaces that toast in place, so a pending one can resolve. */
	id?: string;
	message: string;
	description?: string;
	state?: ToastState;
	action?: ToastAction;
	lifetime?: number;
};
type Note = ToastInput & { id: string };
type ToastClock = { waits: Map<string, number>; since: number | null };
type StackSlot = { y: number; scale: number; opacity: number };
type StackCard = { id: string; render: (behind: boolean) => ReactNode };

let nextId = 0;
// Effects run children first, so a page can toast on mount before <Toasts />
// listens. Those toasts wait here until it does.
let listening = false;
const early: Note[] = [];

export function toast(input: string | ToastInput) {
	const detail = typeof input === "string" ? { message: input } : input;
	const note = { ...detail, id: detail.id ?? `toast-${++nextId}` };
	if (listening) window.dispatchEvent(new CustomEvent(EVENT, { detail: note }));
	else early.push(note);
}

export function dismissToast(id: string) {
	window.dispatchEvent(new CustomEvent(DISMISS, { detail: id }));
}

function upsertToast(notes: readonly Note[], note: Note): Note[] {
	const index = notes.findIndex((item) => item.id === note.id);
	return index === -1 ? [note, ...notes] : notes.map((item, at) => (at === index ? note : item));
}

/** Pending toasts stay until resolved; more to read or do means more time. */
function dismissDelay(note: Note): number | null {
	if (note.state === "pending") return null;
	if (note.lifetime !== undefined) return note.lifetime;
	return note.action ? ACTION_LIFETIME : note.description ? DETAIL_LIFETIME : LIFETIME;
}

/** Spends the time since the last tick from every waiting toast. */
function tick(clock: ToastClock, at: number) {
	if (clock.since === null) return;
	const spent = at - clock.since;
	clock.since = at;
	for (const [id, left] of clock.waits) clock.waits.set(id, left - spent);
}

/** Collapsed: each card peeks out behind the front one, smaller and fainter. */
function pileSlot(index: number): StackSlot {
	const depth = Math.min(index, DEPTH - 1);
	return {
		y: depth * PEEK,
		scale: 1 - depth * SHRINK,
		opacity: index < DEPTH ? 1 - depth * FADE : 0,
	};
}

/** Fanned out: cards sit in a column at their real heights. */
function fanSlot(index: number, heights: readonly number[]): StackSlot {
	let y = 0;
	for (let at = 0; at < index; at++) y += (heights[at] ?? LINE_HEIGHT) + GAP;
	return { y, scale: 1, opacity: 1 };
}

const MARKS = {
	success: { icon: CheckmarkCircle02Icon, ink: "text-success" },
	error: { icon: Alert02Icon, ink: "text-destructive" },
	info: { icon: InformationCircleIcon, ink: "text-muted-foreground" },
} as const;

function ToastGlyph({ state }: { state: ToastState }) {
	if (state === "pending") return <Ring size={16} color="currentColor" />;
	const { icon, ink } = MARKS[state];
	return <HugeiconsIcon icon={icon} className={cn("size-4 shrink-0", ink)} aria-hidden />;
}

// The design system's icon morph: scale from 0.25 with a 4px blur.
const GLYPH_POP = {
	initial: { opacity: 0, scale: 0.25, filter: "blur(4px)" },
	animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
	exit: { opacity: 0, scale: 0.25, filter: "blur(4px)", transition: EXIT },
} as const;

const REVEAL = {
	delay: 0.04,
	sweep: 0.16,
	step: 0.02,
	duration: 0.24,
	after: 0.06,
	ease: [0.23, 1, 0.32, 1],
} as const;

// Scripts whose letters join; revealing them letter by letter breaks the joins.
const JOINED =
	/[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Nko}\p{Script=Mongolian}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}\p{Script=Mandaic}]/u;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Fades text in from a blur, letter by letter (word by word for `words`). */
function RevealText({
	text,
	words = false,
	after = 0,
}: {
	text: string;
	words?: boolean;
	after?: number;
}) {
	const reduceMotion = useReducedMotion();
	const parts =
		words || JOINED.test(text)
			? text.split(/(\s+)/).filter(Boolean)
			: [...graphemes.segment(text)].map(({ segment }) => segment);
	const step = Math.min(REVEAL.step, REVEAL.sweep / Math.max(parts.length - 1, 1));
	return (
		<>
			<span className="sr-only">{text}</span>
			<span aria-hidden>
				{parts.map((part, index) => (
					<motion.span
						key={index}
						initial={reduceMotion ? false : { opacity: 0, filter: "blur(4px)" }}
						animate={{ opacity: 1, filter: "blur(0px)" }}
						transition={{
							duration: REVEAL.duration,
							ease: REVEAL.ease,
							delay: REVEAL.delay + after + index * step,
						}}
					>
						{part}
					</motion.span>
				))}
			</span>
		</>
	);
}

/** A bar's title stays on one line and truncates; a card's title wraps. */
function ToastLine({
	message,
	reveal = false,
	from = 0,
	wrap = false,
}: {
	message: string;
	reveal?: boolean;
	from?: number;
	wrap?: boolean;
}) {
	const [revealed] = useState(reveal);
	const fading = !useIsPresent();
	return (
		<motion.div
			initial={{ width: from }}
			animate={{ width: "auto" }}
			exit={{ opacity: 0, filter: "blur(4px)", transition: EXIT }}
			transition={MORPH}
			className={cn("flex items-center overflow-hidden", fading && "absolute inset-y-0 start-0")}
		>
			<span className={cn("max-w-full", wrap ? "py-2 text-pretty" : "w-max shrink-0 truncate")}>
				{revealed ? <RevealText text={message} /> : message}
			</span>
		</motion.div>
	);
}

function ToastDetail({ text, reveal, from }: { text: string; reveal: boolean; from: number }) {
	const [revealed] = useState(reveal);
	const present = useIsPresent();
	const swapping = usePresenceData() === true;
	const fading = !present && swapping;
	return (
		<motion.div
			initial={{
				height: from,
				opacity: revealed ? 1 : 0,
				filter: revealed ? "blur(0px)" : "blur(4px)",
			}}
			animate={{ height: "auto", opacity: 1, filter: "blur(0px)" }}
			exit="leave"
			variants={{
				leave: (swap: boolean) =>
					swap
						? { opacity: 0, filter: "blur(4px)", transition: EXIT }
						: { height: 0, opacity: 0, filter: "blur(4px)" },
			}}
			transition={MORPH}
			className={cn("overflow-hidden", fading && "absolute inset-x-0 top-0")}
		>
			<p className="pb-1 text-pretty text-muted-foreground">
				{revealed ? <RevealText text={text} words after={REVEAL.after} /> : text}
			</p>
		</motion.div>
	);
}

/**
 * One toast. A single line is a slim bar; a description morphs it into a card
 * 340px wide. Changing the message, state or description of a live toast
 * morphs it in place. Drag it away to dismiss.
 */
function ToastPill({
	state,
	message,
	description,
	action,
	onAction,
	onDismiss,
	behind,
}: {
	state?: ToastState;
	message: string;
	description?: string;
	action?: ToastAction;
	onAction: () => void;
	onDismiss: () => void;
	behind: boolean;
}) {
	const lines = useRef<HTMLDivElement>(null);
	const details = useRef<HTMLDivElement>(null);
	const viewport = useViewportWidth();
	// A bar keeps its action at the end of the line; a card moves it under the text.
	const inline = action !== undefined && !description;
	const below = action !== undefined && Boolean(description);
	const [lineWidth, setLineWidth] = useState(0);
	const [detailHeight, setDetailHeight] = useState(0);
	useLayoutEffect(() => {
		const line = lines.current;
		const detail = details.current;
		if (!line || !detail) return;
		const observer = new ResizeObserver(() => {
			setLineWidth(line.offsetWidth);
			setDetailHeight(detail.offsetHeight);
		});
		observer.observe(line);
		observer.observe(detail);
		return () => observer.disconnect();
	}, []);

	// Only text that changed on a live toast gets the reveal.
	const [last, setLast] = useState({ message, state, description });
	const [reveal, setReveal] = useState(false);
	const [revealDetail, setRevealDetail] = useState(false);
	const [detailSwap, setDetailSwap] = useState(false);
	if (last.message !== message || last.state !== state || last.description !== description) {
		setReveal(last.message !== message);
		setRevealDetail(last.description !== description);
		setDetailSwap(Boolean(last.description) && Boolean(description));
		setLast({ message, state, description });
	}

	return (
		<motion.div
			role={state === "error" ? "alert" : "status"}
			drag={!behind}
			dragSnapToOrigin
			dragElastic={0.6}
			dragMomentum={false}
			dragTransition={{ bounceStiffness: 520, bounceDamping: 42 }}
			onDragEnd={(_, info) => {
				const far = Math.hypot(info.offset.x, info.offset.y) > SWIPE;
				const fast = Math.hypot(info.velocity.x, info.velocity.y) > FLICK;
				if (far || fast) onDismiss();
			}}
			className={cn(
				"toast-surface relative flex max-w-[min(32rem,100%)] overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10",
				behind ? "pointer-events-none" : "pointer-events-auto cursor-grab active:cursor-grabbing",
				inline ? "pe-1.5" : "pe-4",
				state ? "ps-3" : "ps-4",
				description && "pt-0.5",
			)}
		>
			<motion.div
				animate={{ opacity: behind ? 0 : 1 }}
				transition={MORPH}
				className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center"
			>
				<div className="col-start-1 row-start-1 flex">
					<AnimatePresence initial={false}>
						{state ? (
							<motion.div
								key="glyph"
								initial={{ width: 0 }}
								animate={{ width: "auto" }}
								exit={{ width: 0 }}
								transition={MORPH}
								className="flex justify-end"
							>
								<div className="flex w-max items-center pe-2.5">
									<AnimatePresence initial={false} mode="popLayout">
										<motion.span
											key={state}
											{...GLYPH_POP}
											transition={MORPH}
											className={cn(
												"flex size-4 shrink-0 items-center justify-center",
												state === "pending" && "text-muted-foreground",
											)}
										>
											<ToastGlyph state={state} />
										</motion.span>
									</AnimatePresence>
								</div>
							</motion.div>
						) : null}
					</AnimatePresence>
				</div>

				<div
					ref={lines}
					className={cn(
						"relative col-start-2 row-start-1 flex min-h-9 min-w-0 items-center justify-self-start",
						description && "font-medium",
					)}
				>
					<AnimatePresence initial={false}>
						<ToastLine
							key={message}
							message={message}
							reveal={reveal}
							from={lineWidth}
							wrap={Boolean(description)}
						/>
					</AnimatePresence>
				</div>

				<div className="col-start-3 row-start-1 flex">
					<AnimatePresence initial={false}>
						{inline ? (
							<motion.div
								key="action"
								initial={{ width: 0 }}
								animate={{ width: "auto" }}
								exit={{ width: 0 }}
								transition={MORPH}
								className="flex items-center overflow-hidden"
							>
								<div className="w-max ps-6">
									<Button type="button" size="xs" onClick={onAction}>
										{action.label}
									</Button>
								</div>
							</motion.div>
						) : null}
					</AnimatePresence>
				</div>

				<div
					ref={details}
					className={cn(
						"toast-detail relative -top-1.5 col-span-2 col-start-2 row-start-2 w-0 min-w-full",
					)}
				>
					<AnimatePresence initial={false} custom={detailSwap}>
						{description ? (
							<ToastDetail
								key={description}
								text={description}
								reveal={revealDetail}
								from={detailSwap ? detailHeight : 0}
							/>
						) : null}
					</AnimatePresence>
				</div>

				{/* On a card the action gets its own row, lined up with the text. */}
				<div className="col-span-2 col-start-2 row-start-3 flex">
					<AnimatePresence initial={false}>
						{below ? (
							<motion.div
								key="action"
								initial={{ height: 0, opacity: 0 }}
								animate={{ height: "auto", opacity: 1 }}
								exit={{ height: 0, opacity: 0 }}
								transition={MORPH}
								className="overflow-hidden"
							>
								<div className="pt-0.5 pb-3">
									<Button type="button" size="xs" onClick={onAction}>
										{action.label}
									</Button>
								</div>
							</motion.div>
						) : null}
					</AnimatePresence>
				</div>

				{/* Widens to a card when there's a description, so the text wraps at 340px. */}
				<motion.div
					aria-hidden
					initial={false}
					animate={{
						width: description
							? Math.min(CARD_WIDTH, viewport - GUTTERS) - (state ? 12 : 16) - 16
							: 0,
					}}
					transition={MORPH}
					className="col-span-3 col-start-1 row-start-4"
				/>
			</motion.div>
		</motion.div>
	);
}

function sameBoxes(
	first: Record<string, { width: number; height: number }>,
	second: Record<string, { width: number; height: number }>,
) {
	const ids = Object.keys(second);
	return (
		ids.length === Object.keys(first).length &&
		ids.every(
			(id) => first[id]?.width === second[id]?.width && first[id]?.height === second[id]?.height,
		)
	);
}

/**
 * Animates a max-width or max-height to `cap`, or back to the natural size
 * and then to `none` when `cap` is null. Cards behind the front one take its
 * size, so the pile reads as one stack.
 */
function useCap(
	box: RefObject<HTMLDivElement | null>,
	side: "maxWidth" | "maxHeight",
	cap: number | null,
) {
	const limit = useMotionValue<number | string>("none");
	useLayoutEffect(() => {
		const element = box.current;
		if (!element) return;
		const natural = () => {
			const held = element.style[side];
			element.style[side] = "";
			const size = side === "maxWidth" ? element.offsetWidth : element.offsetHeight;
			element.style[side] = held;
			return size;
		};
		if (cap === null) {
			if (limit.get() === "none") return;
			const release = () => limit.set("none");
			const controls = animate(limit, natural(), {
				...MORPH,
				onComplete: () => frame.update(release),
			});
			return () => {
				controls.stop();
				cancelFrame(release);
			};
		}
		if (limit.get() === "none") limit.set(natural());
		const controls = animate(limit, cap, MORPH);
		return () => controls.stop();
	}, [box, side, cap, limit]);
	return limit;
}

function DeckCap({
	width,
	height,
	ref,
	children,
}: {
	width: number | null;
	height: number | null;
	ref: (element: HTMLDivElement | null) => void;
	children: ReactNode;
}) {
	const box = useRef<HTMLDivElement | null>(null);
	const maxWidth = useCap(box, "maxWidth", width);
	const maxHeight = useCap(box, "maxHeight", height);
	return (
		<motion.div
			ref={(element) => {
				box.current = element;
				ref(element);
			}}
			style={{ maxWidth, maxHeight }}
			className="relative flex flex-col"
		>
			{children}
		</motion.div>
	);
}

function DeckSlot({
	layer,
	style,
	...motionProps
}: ComponentProps<typeof motion.div> & { layer: number }) {
	const present = useIsPresent();
	return <motion.div {...motionProps} style={{ ...style, zIndex: present ? layer : 0 }} />;
}

/** Piles toasts while idle; fans them out while pointed at, focused or held. */
function ToastStack({
	cards,
	onOpen,
	position,
}: {
	cards: StackCard[];
	onOpen: (open: boolean) => void;
	position: ToastPosition;
}) {
	const [pointing, setPointing] = useState(false);
	const [focused, setFocused] = useState(false);
	const [holding, setHolding] = useState(false);
	const [boxes, setBoxes] = useState<Record<string, { width: number; height: number }>>({});
	const measured = useRef(new Map<string, HTMLElement>());
	const root = useRef<HTMLDivElement>(null);
	const rtl = useDirection() === "rtl";

	const open = pointing || focused || holding;
	const piled = cards.length > 1 && !open;

	useEffect(() => onOpen(open), [onOpen, open]);

	useEffect(() => {
		if (!holding) return;
		const release = () => setHolding(false);
		const check = (event: PointerEvent) => {
			if (event.buttons === 0) release();
		};
		window.addEventListener("pointerup", release);
		window.addEventListener("pointercancel", release);
		window.addEventListener("pointermove", check);
		return () => {
			window.removeEventListener("pointerup", release);
			window.removeEventListener("pointercancel", release);
			window.removeEventListener("pointermove", check);
		};
	}, [holding]);

	// The stack is pointer-events: none between cards, so hover is hit-tested by hand.
	const at = useRef<{ x: number; y: number } | null>(null);
	const overCards = useCallback(() => {
		const point = at.current;
		if (!point) return false;
		return [...measured.current.values()].some((element) => {
			const box = element.getBoundingClientRect();
			return (
				point.x >= box.left - REACH &&
				point.x <= box.right + REACH &&
				point.y >= box.top - REACH &&
				point.y <= box.bottom + REACH
			);
		});
	}, []);

	useEffect(() => {
		const onMove = (event: PointerEvent) => {
			at.current = { x: event.clientX, y: event.clientY };
			setPointing(overCards());
		};
		const onLeave = () => {
			at.current = null;
			setPointing(false);
		};
		window.addEventListener("pointermove", onMove);
		document.documentElement.addEventListener("pointerleave", onLeave);
		return () => {
			window.removeEventListener("pointermove", onMove);
			document.documentElement.removeEventListener("pointerleave", onLeave);
		};
	}, [overCards]);

	// Cards move under a still pointer as they fan out, so keep checking while open.
	useEffect(() => {
		if (!pointing) return;
		let raf = requestAnimationFrame(function check() {
			if (!overCards()) return setPointing(false);
			raf = requestAnimationFrame(check);
		});
		return () => cancelAnimationFrame(raf);
	}, [pointing, overCards]);

	useEffect(() => {
		if (!focused) return;
		let raf = requestAnimationFrame(function check() {
			if (!root.current?.contains(document.activeElement)) return setFocused(false);
			raf = requestAnimationFrame(check);
		});
		return () => cancelAnimationFrame(raf);
	}, [focused]);

	const measure = useCallback(() => {
		const next: Record<string, { width: number; height: number }> = {};
		for (const [id, element] of measured.current) {
			const { maxWidth, maxHeight } = element.style;
			element.style.maxWidth = "";
			element.style.maxHeight = "";
			next[id] = { width: element.offsetWidth, height: element.offsetHeight };
			element.style.maxWidth = maxWidth;
			element.style.maxHeight = maxHeight;
		}
		setBoxes((current) => (sameBoxes(current, next) ? current : next));
	}, []);

	useLayoutEffect(measure, [cards, measure]);

	const sizes = useRef<ResizeObserver | null>(null);
	useEffect(() => {
		const observer = new ResizeObserver(measure);
		for (const element of measured.current.values()) observer.observe(element);
		sizes.current = observer;
		return () => observer.disconnect();
	}, [measure]);

	const heights = cards.map((card) => boxes[card.id]?.height ?? LINE_HEIGHT);
	const deck = cards[0] ? boxes[cards[0].id] : undefined;
	const [side, edge] = position.split("-") as [ToastSide, ToastEdge];
	const corner = edge === "center" ? "center" : (edge === "start") !== rtl ? "left" : "right";
	const fall = side === "top" ? 1 : -1;

	return (
		<div
			ref={root}
			aria-live="polite"
			onPointerDown={() => setHolding(true)}
			onFocus={() => setFocused(true)}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
			}}
			className={cn(
				"pointer-events-none fixed inset-x-0 z-100",
				side === "top" ? "top-4" : "bottom-4",
			)}
		>
			<AnimatePresence initial={false}>
				{cards.map((card, index) => {
					const slot = piled ? pileSlot(index) : fanSlot(index, heights);
					// A shorter card behind a taller one drops to peek out at the bottom.
					const drop =
						piled && index > 0
							? Math.max(0, (heights[0] ?? LINE_HEIGHT) - (heights[index] ?? LINE_HEIGHT))
							: 0;
					const y = (slot.y + drop) * fall;
					const from = (slot.y + drop - 8) * fall;
					return (
						<DeckSlot
							key={card.id}
							layer={cards.length - index}
							style={{ transformOrigin: `${side} ${corner}` }}
							initial={{ opacity: 0, y: from, scale: slot.scale * 0.98 }}
							animate={{ opacity: slot.opacity, y, scale: slot.scale }}
							exit={{ opacity: 0, y: from, scale: slot.scale * 0.96, transition: EXIT }}
							transition={MORPH}
							className={cn(
								"absolute inset-x-0 flex px-4",
								side === "top" ? "top-0" : "bottom-0",
								JUSTIFY[edge],
							)}
							aria-hidden={slot.opacity === 0 || undefined}
						>
							<DeckCap
								width={piled && index > 0 ? (deck?.width ?? null) : null}
								height={piled && index > 0 ? (deck?.height ?? null) : null}
								ref={(element) => {
									if (element) {
										measured.current.set(card.id, element);
										sizes.current?.observe(element);
										return;
									}
									const gone = measured.current.get(card.id);
									if (gone) sizes.current?.unobserve(gone);
									measured.current.delete(card.id);
								}}
							>
								{card.render(piled && index > 0)}
							</DeckCap>
						</DeckSlot>
					);
				})}
			</AnimatePresence>
		</div>
	);
}

function subscribeVisibility(onChange: () => void) {
	document.addEventListener("visibilitychange", onChange);
	return () => document.removeEventListener("visibilitychange", onChange);
}

function useDocumentHidden() {
	return useSyncExternalStore(
		subscribeVisibility,
		() => document.hidden,
		() => false,
	);
}

/**
 * Mount once. Listens for `toast()` calls anywhere in the app. Lifetimes
 * pause while the stack is read (hovered, focused or held) and while the tab
 * is hidden.
 */
export function Toasts({ position = "bottom-end" }: { position?: ToastPosition }) {
	const [notes, setNotes] = useState<Note[]>([]);
	const [reading, setReading] = useState(false);
	const hidden = useDocumentHidden();
	const paused = reading || hidden;
	const clock = useRef<ToastClock>({ waits: new Map(), since: null });
	// The last toast issued, so an action that re-toasts its own id keeps it.
	const issued = useRef<string | null>(null);

	useEffect(() => {
		clock.current.since = performance.now();
		const onToast = (event: Event) => {
			if (!(event instanceof CustomEvent)) return;
			const note: Note = event.detail;
			issued.current = note.id;
			setNotes((current) => upsertToast(current, note));
			tick(clock.current, performance.now());
			const delay = dismissDelay(note);
			if (delay === null) clock.current.waits.delete(note.id);
			else clock.current.waits.set(note.id, delay);
		};
		const onDismiss = (event: Event) => {
			if (!(event instanceof CustomEvent)) return;
			const id: string = event.detail;
			clock.current.waits.delete(id);
			setNotes((current) => current.filter((note) => note.id !== id));
		};
		window.addEventListener(EVENT, onToast);
		window.addEventListener(DISMISS, onDismiss);
		listening = true;
		for (const note of early.splice(0)) {
			window.dispatchEvent(new CustomEvent(EVENT, { detail: note }));
		}
		return () => {
			listening = false;
			window.removeEventListener(EVENT, onToast);
			window.removeEventListener(DISMISS, onDismiss);
		};
	}, []);

	useEffect(() => {
		tick(clock.current, performance.now());
		clock.current.since = paused ? null : performance.now();
	}, [paused]);

	useEffect(() => {
		if (paused) return;
		tick(clock.current, performance.now());
		const waits = [...clock.current.waits.values()];
		if (waits.length === 0) return;
		const timer = window.setTimeout(
			() => {
				tick(clock.current, performance.now());
				const expired = new Set<string>();
				for (const [id, left] of clock.current.waits) if (left <= 0) expired.add(id);
				for (const id of expired) clock.current.waits.delete(id);
				setNotes((current) => current.filter((note) => !expired.has(note.id)));
			},
			Math.max(0, Math.min(...waits)),
		);
		return () => window.clearTimeout(timer);
	}, [notes, paused]);

	return (
		<MotionConfig reducedMotion="user">
			<ToastStack
				position={position}
				onOpen={setReading}
				cards={notes.map((note) => {
					const drop = () => {
						clock.current.waits.delete(note.id);
						setNotes((current) => current.filter((item) => item.id !== note.id));
					};
					const act = () => {
						issued.current = null;
						note.action?.run();
						if (issued.current !== note.id) drop();
					};
					return {
						id: note.id,
						render: (behind) => (
							<ToastPill
								state={note.state}
								message={note.message}
								description={note.description}
								action={note.action}
								onAction={act}
								onDismiss={drop}
								behind={behind}
							/>
						),
					};
				})}
			/>
		</MotionConfig>
	);
}
