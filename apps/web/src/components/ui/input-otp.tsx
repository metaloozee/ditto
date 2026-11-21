// Adapted from Kobra's input-otp (kobra.systems/components/input-otp), restyled on
// Ditto's tokens: sunken field slots, the focus-blue ring, the success color.
import { cn } from "cn";
import { OTPInput, OTPInputContext } from "input-otp";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { flushSync } from "react-dom";

type Sweep = { id: number; from: number; to: number; tone: "paste" | "success" };

type InputOTPStatus = {
	invalid: boolean;
	success: boolean;
	sweep: Sweep | null;
	landing: boolean;
};

const InputOTPStatusContext = React.createContext<InputOTPStatus>({
	invalid: false,
	success: false,
	sweep: null,
	landing: false,
});

const SWEEP_TIMING = {
	paste: { duration: 0.4, stagger: 0.045 },
	success: { duration: 0.42, stagger: 0.048 },
} as const;

const RING_TRAVEL = 0.42;

const DIGIT_SPRING = { type: "spring", duration: 0.3, bounce: 0.2 } as const;

const DIGITS = "^[0-9\\u0660-\\u0669\\u06f0-\\u06f9]+$";

type RingBox = { x: number; y: number; width: number; height: number };

/** Pulls the code out of pasted text such as "Your code is 123-456." */
function codeIn(pasted: string, maxLength: number) {
	const runs = (westernDigits(pasted.normalize("NFKC")).match(/\d(?:[\s‐‑–-]?\d)*/g) ?? []).map(
		(run) => run.replace(/\D/g, ""),
	);
	return runs.find((run) => run.length === maxLength) ?? runs.join("");
}

function westernDigits(text: string) {
	return text.replace(/[٠-٩۰-۹]/g, (digit) => String(digit.charCodeAt(0) % 16));
}

function pasteInto(value: string, pasted: string, maxLength: number, start: number, end: number) {
	const digits = codeIn(pasted, maxLength);
	if (!digits) return null;
	const whole = digits.length >= maxLength;
	const from = whole ? 0 : start;
	const next = (value.slice(0, from) + digits + value.slice(whole ? value.length : end)).slice(
		0,
		maxLength,
	);
	return { next, from, to: Math.min(from + digits.length, maxLength) };
}

/**
 * A one-time-code field. One ring slides between slots as focus moves, a paste
 * lands with a trail across the filled slots, a full code dims in a wave while
 * it's checked, and `success` sweeps the row and hops each digit.
 * `aria-invalid` turns the ring red.
 */
function InputOTP({
	className,
	containerClassName,
	"aria-invalid": ariaInvalid,
	value,
	defaultValue,
	onChange,
	onPaste,
	onPasteCapture,
	success = false,
	maxLength,
	children,
	...props
}: Omit<React.ComponentProps<typeof OTPInput>, "render" | "children"> & {
	children?: React.ReactNode;
	containerClassName?: string;
	success?: boolean;
}) {
	const invalid = ariaInvalid === true || ariaInvalid === "true";
	const reduceMotion = useReducedMotion();
	const [sweep, setSweep] = React.useState<Sweep | null>(null);
	const sweepId = React.useRef(0);
	const [written, setWritten] = React.useState(0);
	const [held, setHeld] = React.useState(typeof defaultValue === "string" ? defaultValue : "");
	const current = value ?? held;

	const startSweep = (from: number, to: number, tone: Sweep["tone"]) => {
		sweepId.current += 1;
		setSweep({ id: sweepId.current, from, to, tone });
	};

	const commit = (next: string) => {
		if (value === undefined) setHeld(next);
		onChange?.(next);
	};

	const handleChange = (typed: string) => {
		const next = westernDigits(typed);
		if (!reduceMotion && next.length - current.length > 1) {
			startSweep(current.length, next.length, "paste");
		}
		commit(next);
	};

	const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
		onPasteCapture?.(event);
		onPaste?.(event);
		event.stopPropagation();
		if (event.defaultPrevented) return;
		event.preventDefault();

		const input = event.currentTarget;
		if (input.readOnly) return;
		const pasted = pasteInto(
			current,
			event.clipboardData.getData("text/plain"),
			maxLength,
			input.selectionStart ?? current.length,
			input.selectionEnd ?? current.length,
		);
		if (!pasted || pasted.next === current) return;

		flushSync(() => {
			if (!reduceMotion) startSweep(pasted.from, pasted.to, "paste");
			commit(pasted.next);
		});
		const { length } = input.value;
		input.setSelectionRange(Math.min(length, maxLength - 1), length);
	};

	React.useEffect(() => {
		if (!success || reduceMotion) return;
		sweepId.current += 1;
		setSweep({ id: sweepId.current, from: 0, to: maxLength, tone: "success" });
	}, [success, maxLength, reduceMotion]);

	React.useEffect(() => {
		if (!sweep) return;
		const { duration, stagger } = SWEEP_TIMING[sweep.tone];
		const span = duration + stagger * (sweep.to - sweep.from);
		const timers = [
			window.setTimeout(() => setSweep(null), span * 1000),
			window.setTimeout(() => setWritten(sweep.id), stagger * (sweep.to - sweep.from - 1) * 1000),
		];
		return () => {
			for (const timer of timers) window.clearTimeout(timer);
		};
	}, [sweep]);

	const landing = sweep?.tone === "paste" && written !== sweep.id;

	return (
		<InputOTPStatusContext.Provider value={{ invalid, success, sweep, landing }}>
			<OTPInput
				data-slot="input-otp"
				data-success={success || undefined}
				aria-invalid={ariaInvalid}
				value={current}
				onChange={handleChange}
				onPasteCapture={handlePaste}
				maxLength={maxLength}
				containerClassName={cn(
					"relative flex w-full items-center gap-2 [direction:ltr] has-disabled:opacity-50",
					containerClassName,
				)}
				spellCheck={false}
				className={cn("disabled:cursor-not-allowed", className)}
				{...props}
				dir="ltr"
				inputMode="numeric"
				pattern={DIGITS}
			>
				{children}
				<InputOTPRing />
			</OTPInput>
		</InputOTPStatusContext.Provider>
	);
}

/** The one focus ring, measured onto the active slot (or the selected run). */
function InputOTPRing() {
	const context = React.useContext(OTPInputContext);
	const { invalid, sweep, landing } = React.useContext(InputOTPStatusContext);
	const reduceMotion = useReducedMotion();
	const ref = React.useRef<HTMLSpanElement>(null);
	const [box, setBox] = React.useState<RingBox | null>(null);
	const wasShown = React.useRef(false);
	const everShown = React.useRef(false);

	const slots = context?.slots ?? [];
	let first = -1;
	let last = -1;
	for (const [index, slot] of slots.entries()) {
		if (!slot.isActive) continue;
		if (first === -1) first = index;
		last = index;
	}
	const complete = slots.length > 0 && slots.every((slot) => Boolean(slot.char));
	const shown = first !== -1 && (!complete || last > first || landing);

	const measure = React.useCallback(() => {
		const container = ref.current?.closest("[data-input-otp-container]");
		const from = container?.querySelector(`[data-slot="input-otp-slot"][data-index="${first}"]`);
		const to = container?.querySelector(`[data-slot="input-otp-slot"][data-index="${last}"]`);
		if (!container || !from || !to) return;
		const row = container.getBoundingClientRect();
		const head = from.getBoundingClientRect();
		const tail = to.getBoundingClientRect();
		setBox({
			x: head.left - row.left,
			y: head.top - row.top,
			width: tail.right - head.left,
			height: head.height,
		});
	}, [first, last]);

	React.useLayoutEffect(() => {
		if (!shown) return;
		measure();
		const container = ref.current?.closest("[data-input-otp-container]");
		if (!container || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(container);
		return () => observer.disconnect();
	}, [shown, measure]);

	// The first appearance snaps into place; after that the ring travels.
	const jump = !wasShown.current;
	const appear =
		everShown.current && !reduceMotion
			? { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const }
			: { duration: 0 };
	React.useEffect(() => {
		wasShown.current = shown && box !== null;
		if (wasShown.current) everShown.current = true;
	});

	const spring = reduceMotion
		? { duration: 0 }
		: { type: "spring" as const, duration: sweep ? RING_TRAVEL : 0.3, bounce: 0.18 };
	const move = jump ? { duration: 0 } : spring;

	return (
		<motion.span
			ref={ref}
			data-slot="input-otp-ring"
			aria-hidden
			initial={false}
			animate={{
				x: box?.x ?? 0,
				y: box?.y ?? 0,
				width: box?.width ?? 0,
				height: box?.height ?? 0,
				opacity: shown && box ? 1 : 0,
			}}
			transition={{ x: move, y: move, width: move, height: move, opacity: appear }}
			className={cn(
				"pointer-events-none absolute top-0 left-0 z-20 rounded-lg ring-2",
				invalid ? "ring-destructive" : "ring-ring",
			)}
		/>
	);
}

function InputOTPSlot({
	index,
	className,
	style,
	...props
}: React.ComponentProps<"div"> & {
	index: number;
}) {
	const inputOTPContext = React.useContext(OTPInputContext);
	const { invalid, success, sweep, landing } = React.useContext(InputOTPStatusContext);
	const { char, isActive } = inputOTPContext?.slots[index] ?? {};
	const swept = sweep !== null && index >= sweep.from && index < sweep.to;
	const isComplete = inputOTPContext?.slots.every((slot) => Boolean(slot.char)) ?? false;
	const reduceMotion = useReducedMotion();
	const delay =
		swept && sweep?.tone === "paste" ? (index - sweep.from) * SWEEP_TIMING.paste.stagger : 0;

	return (
		<div
			data-slot="input-otp-slot"
			data-active={isActive}
			data-index={index}
			aria-invalid={invalid || undefined}
			className={cn(
				"relative flex h-12 min-w-0 flex-1 items-center justify-center rounded-lg field font-mono text-xl font-medium tabular-nums data-[active=true]:z-10 aria-invalid:border-destructive/50",
				swept && sweep?.tone === "success" && "otp-bounce",
				className,
			)}
			style={
				{ ...style, "--otp-trail-index": sweep ? index - sweep.from : 0 } as React.CSSProperties
			}
			{...props}
		>
			{swept && sweep ? (
				<span
					key={`${sweep.id}-${index}`}
					aria-hidden
					className={cn(
						"pointer-events-none absolute inset-0 rounded-lg",
						sweep.tone === "success" ? "otp-trail-success" : "otp-trail",
					)}
				/>
			) : null}
			<span
				className={cn(
					"relative grid place-items-center [perspective:240px]",
					isComplete && !success && !landing && !invalid && "otp-processing",
				)}
				style={{ "--otp-wave-index": index } as React.CSSProperties}
			>
				<span
					aria-hidden
					className={cn(
						"col-start-1 row-start-1 text-muted-foreground/40 transition-opacity duration-150 ease-out motion-reduce:transition-none",
						char ? "opacity-0" : "opacity-100",
					)}
					style={{ transitionDelay: `${delay}s` }}
				>
					0
				</span>
				<AnimatePresence initial={false} custom={delay}>
					{char ? (
						<motion.span
							key={`${index}-${char}`}
							custom={delay}
							initial={
								reduceMotion
									? false
									: {
											opacity: 0,
											transform: "translateY(6px) rotateX(-35deg)",
											filter: "blur(2px)",
										}
							}
							animate={{
								opacity: 1,
								transform: "translateY(0px) rotateX(0deg)",
								filter: "blur(0px)",
							}}
							exit="leave"
							variants={{
								leave: (after: number) =>
									reduceMotion
										? { opacity: 0, transition: { duration: 0 } }
										: {
												opacity: 0,
												transform: "translateY(-2px) rotateX(15deg)",
												filter: "blur(2px)",
												transition: { ...DIGIT_SPRING, delay: after },
											},
							}}
							transition={reduceMotion ? { duration: 0 } : { ...DIGIT_SPRING, delay }}
							style={{ transformOrigin: "center bottom", transformStyle: "preserve-3d" }}
							className="col-start-1 row-start-1 text-foreground"
						>
							{char}
						</motion.span>
					) : null}
				</AnimatePresence>
			</span>
		</div>
	);
}

export { InputOTP, InputOTPSlot };
