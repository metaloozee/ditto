import fs from "node:fs";
import path from "node:path";
import type {
	AssistantMessage,
	Context,
	FauxResponseStep,
	Message,
	ToolResultMessage,
} from "@earendil-works/pi-ai";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxToolCall,
	Type,
} from "@earendil-works/pi-ai";
import {
	CURRENT_SESSION_VERSION,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionFactory,
	type FileEntry,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

export const PI_VERSION = "0.85.1";
export const ADAPTER_VERSION = 1;
export const CHECKPOINT_VERSION = 1;
export const FIXTURE_LIMITS = {
	maxBytes: 8192,
	maxEntries: 32,
	maxNesting: 16,
} as const;
export interface Authority {
	incarnation: string;
	epoch: number;
	attempt: number;
}
export interface CheckpointSettings {
	compaction: {
		enabled: boolean;
		reserveTokens: number;
		keepRecentTokens: number;
	};
	retry: { enabled: boolean; maxRetries: number; baseDelayMs: number };
}
export interface RecoveryCheckpoint {
	checkpointVersion: 1;
	adapterVersion: 1;
	piVersion: "0.85.1";
	sessionVersion: 3;
	fileEntries: FileEntry[];
	leafId: string;
	settings: CheckpointSettings;
	extensionState: Record<string, unknown>;
	acceptedCommandIds: string[];
	consumedCommandIds: string[];
	committedProviderResponses: AssistantMessage[];
	actualToolResults: ToolResultMessage[];
	attempt: number;
	epoch: number;
	incarnation: string;
	terminal: boolean;
	terminalContent?: string;
}
export type EffectState =
	| "prepared"
	| "admitted"
	| "outcome_unknown"
	| "result_recorded"
	| "materialized";
export interface JournalEffect {
	runId: string;
	assistantEntryId: string;
	toolCallId: string;
	toolName: string;
	arguments: Record<string, unknown>;
	state: EffectState;
	result?: { content: ToolResultMessage["content"]; isError: boolean };
	piEntryId?: string;
}
export interface FollowUp {
	commandId: string;
	text: string;
}
export interface RecoveryJournal {
	authority: Authority;
	runId: string;
	assistantEntryId: string;
	checkpoint: RecoveryCheckpoint;
	effects: JournalEffect[];
	acceptedCommandIds: string[];
	consumedCommandIds: string[];
	followUps: FollowUp[];
	initialCommand?: { commandId: string; userEntryId: string };
	assistantResponseEntryId?: string;
	compactionEntryId?: string;
	extensionTransitions?: Array<{
		toolCallId: string;
		phase: string;
		leafId: string;
	}>;
	spendingAttempts?: Array<{
		kind: SpendingAttemptKind;
		sequence: number;
	}>;
}
export interface Receipt {
	count: number;
	output: string;
}
export type Receipts = Record<string, Receipt>;
const JOURNAL_FILE = "journal.json";
const RECEIPTS_FILE = "receipts.json";
const LATCH_FILE = "admission-latched.json";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}
function nestingDepth(value: unknown, seen = new Set<unknown>()): number {
	if (!isRecord(value) && !Array.isArray(value)) return 0;
	if (seen.has(value)) throw new Error("checkpoint contains a cycle");
	seen.add(value);
	const children = Array.isArray(value) ? value : Object.values(value);
	let depth = 1;
	for (const child of children)
		depth = Math.max(depth, 1 + nestingDepth(child, seen));
	seen.delete(value);
	return depth;
}
function validContent(content: unknown): boolean {
	if (typeof content === "string") return true;
	if (!Array.isArray(content)) return false;
	return content.every((block) => {
		if (!isRecord(block) || typeof block.type !== "string") return false;
		if (block.type === "text") return typeof block.text === "string";
		if (block.type === "thinking") return typeof block.thinking === "string";
		if (block.type === "image")
			return (
				typeof block.data === "string" && typeof block.mimeType === "string"
			);
		if (block.type === "toolCall")
			return (
				typeof block.id === "string" &&
				typeof block.name === "string" &&
				isRecord(block.arguments)
			);
		return false;
	});
}
function validMessage(value: unknown): boolean {
	if (!isRecord(value) || typeof value.role !== "string") return false;
	if (value.role === "user")
		return typeof value.timestamp === "number" && validContent(value.content);
	if (value.role === "assistant")
		return (
			typeof value.api === "string" &&
			typeof value.provider === "string" &&
			typeof value.model === "string" &&
			typeof value.timestamp === "number" &&
			validContent(value.content) &&
			isRecord(value.usage) &&
			typeof value.stopReason === "string"
		);
	if (value.role === "toolResult")
		return (
			typeof value.toolCallId === "string" &&
			typeof value.toolName === "string" &&
			typeof value.isError === "boolean" &&
			typeof value.timestamp === "number" &&
			validContent(value.content)
		);
	return false;
}
function validateEntry(entry: unknown): asserts entry is FileEntry {
	if (!isRecord(entry) || typeof entry.type !== "string")
		throw new Error("invalid session entry");
	if (entry.type === "session") {
		if (
			entry.version !== CURRENT_SESSION_VERSION ||
			typeof entry.id !== "string" ||
			typeof entry.timestamp !== "string" ||
			typeof entry.cwd !== "string"
		)
			throw new Error("invalid session header");
		return;
	}
	if (
		typeof entry.id !== "string" ||
		(entry.parentId !== null && typeof entry.parentId !== "string") ||
		typeof entry.timestamp !== "string"
	)
		throw new Error("invalid session entry identity");
	switch (entry.type) {
		case "message":
			if (!validMessage(entry.message))
				throw new Error("invalid message entry");
			return;
		case "thinking_level_change":
			if (typeof entry.thinkingLevel !== "string")
				throw new Error("invalid thinking entry");
			return;
		case "model_change":
			if (
				typeof entry.provider !== "string" ||
				typeof entry.modelId !== "string"
			)
				throw new Error("invalid model entry");
			return;
		case "compaction":
			if (
				typeof entry.summary !== "string" ||
				typeof entry.firstKeptEntryId !== "string" ||
				typeof entry.tokensBefore !== "number"
			)
				throw new Error("invalid compaction entry");
			return;
		case "branch_summary":
			if (typeof entry.fromId !== "string" || typeof entry.summary !== "string")
				throw new Error("invalid branch summary");
			return;
		case "custom":
			if (typeof entry.customType !== "string")
				throw new Error("invalid custom entry");
			return;
		case "custom_message":
			if (
				typeof entry.customType !== "string" ||
				typeof entry.display !== "boolean" ||
				!validContent(entry.content)
			)
				throw new Error("invalid custom message");
			return;
		case "label":
			if (typeof entry.targetId !== "string") throw new Error("invalid label");
			return;
		case "session_info":
			if (entry.name !== undefined && typeof entry.name !== "string")
				throw new Error("invalid session info");
			return;
		default:
			throw new Error(`unsupported entry type: ${entry.type}`);
	}
}
function validateSettings(value: unknown): asserts value is CheckpointSettings {
	if (!isRecord(value) || !isRecord(value.compaction) || !isRecord(value.retry))
		throw new Error("invalid settings");
	const { compaction, retry } = value;
	if (
		typeof compaction.enabled !== "boolean" ||
		typeof compaction.reserveTokens !== "number" ||
		typeof compaction.keepRecentTokens !== "number" ||
		typeof retry.enabled !== "boolean" ||
		typeof retry.maxRetries !== "number" ||
		typeof retry.baseDelayMs !== "number"
	)
		throw new Error("invalid settings");
}
export function validateCheckpoint(value: unknown): RecoveryCheckpoint {
	if (!isRecord(value)) throw new Error("checkpoint must be an object");
	if (
		value.checkpointVersion !== CHECKPOINT_VERSION ||
		value.adapterVersion !== ADAPTER_VERSION ||
		value.piVersion !== PI_VERSION ||
		value.sessionVersion !== CURRENT_SESSION_VERSION
	)
		throw new Error("unsupported checkpoint version");
	if (
		!Array.isArray(value.fileEntries) ||
		value.fileEntries.length > FIXTURE_LIMITS.maxEntries
	)
		throw new Error("checkpoint entry limit exceeded");
	if (nestingDepth(value) > FIXTURE_LIMITS.maxNesting)
		throw new Error("checkpoint nesting limit exceeded");
	for (const entry of value.fileEntries) validateEntry(entry);
	if (
		value.fileEntries.filter((entry) => entry.type === "session").length !==
			1 ||
		value.fileEntries[0]?.type !== "session"
	)
		throw new Error("checkpoint requires exactly one leading header");
	const entries = value.fileEntries.slice(1);
	const ids = new Set<string>();
	for (const entry of entries) {
		if (ids.has(entry.id)) throw new Error("duplicate entry id");
		ids.add(entry.id);
	}
	if (typeof value.leafId !== "string" || !ids.has(value.leafId))
		throw new Error("selected leaf is absent");
	const positions = new Map(entries.map((entry, index) => [entry.id, index]));
	for (const entry of entries) {
		if (entry.parentId !== null && !ids.has(entry.parentId))
			throw new Error("dangling parent");
		if (entry.type === "compaction") {
			const kept = positions.get(entry.firstKeptEntryId);
			const current = positions.get(entry.id);
			if (kept === undefined || current === undefined || kept >= current)
				throw new Error("invalid compaction reference");
		}
	}
	for (const entry of entries) {
		const seen = new Set<string>();
		let current: (typeof entries)[number] | undefined = entry;
		while (current) {
			if (seen.has(current.id)) throw new Error("cyclic parent links");
			seen.add(current.id);
			current =
				current.parentId === null
					? undefined
					: entries.find((candidate) => candidate.id === current?.parentId);
		}
	}
	validateSettings(value.settings);
	if (
		!isRecord(value.extensionState) ||
		!isStringArray(value.acceptedCommandIds) ||
		!isStringArray(value.consumedCommandIds) ||
		!Array.isArray(value.committedProviderResponses) ||
		!Array.isArray(value.actualToolResults) ||
		typeof value.attempt !== "number" ||
		typeof value.epoch !== "number" ||
		typeof value.incarnation !== "string" ||
		typeof value.terminal !== "boolean" ||
		(value.terminalContent !== undefined &&
			typeof value.terminalContent !== "string")
	)
		throw new Error("invalid checkpoint fields");
	for (const message of value.committedProviderResponses)
		if (!validMessage(message) || message.role !== "assistant")
			throw new Error("invalid provider response");
	for (const message of value.actualToolResults)
		if (!validMessage(message) || message.role !== "toolResult")
			throw new Error("invalid tool result");
	return {
		checkpointVersion: value.checkpointVersion,
		adapterVersion: value.adapterVersion,
		piVersion: value.piVersion,
		sessionVersion: value.sessionVersion,
		fileEntries: value.fileEntries,
		leafId: value.leafId,
		settings: value.settings,
		extensionState: value.extensionState,
		acceptedCommandIds: value.acceptedCommandIds,
		consumedCommandIds: value.consumedCommandIds,
		committedProviderResponses:
			value.committedProviderResponses as AssistantMessage[],
		actualToolResults: value.actualToolResults as ToolResultMessage[],
		attempt: value.attempt,
		epoch: value.epoch,
		incarnation: value.incarnation,
		terminal: value.terminal,
		terminalContent: value.terminalContent,
	};
}
export function parseAndValidateCheckpoint(text: string): RecoveryCheckpoint {
	if (Buffer.byteLength(text, "utf8") > FIXTURE_LIMITS.maxBytes)
		throw new Error("checkpoint byte limit exceeded");
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error("checkpoint is not strict JSON");
	}
	return validateCheckpoint(parsed);
}
export function restoreValidatedCheckpoint(
	checkpoint: RecoveryCheckpoint,
	imageOwnedCwd: string,
) {
	const validated = validateCheckpoint(structuredClone(checkpoint));
	const manager = SessionManager.inMemory(
		imageOwnedCwd,
		undefined,
		structuredClone(validated.fileEntries),
	);
	manager.branch(validated.leafId);
	return {
		sessionManager: manager,
		settingsManager: SettingsManager.inMemory({
			compaction: validated.settings.compaction,
			retry: validated.settings.retry,
		}),
		extensionState: structuredClone(validated.extensionState),
	};
}
function latch(directory: string, reason: string): void {
	try {
		fs.mkdirSync(directory, { recursive: true });
		fs.writeFileSync(
			path.join(directory, LATCH_FILE),
			JSON.stringify({ reason }),
		);
	} catch {}
}
function durableWrite(file: string, value: unknown): void {
	const directory = path.dirname(file);
	fs.mkdirSync(directory, { recursive: true });
	const temporary = `${file}.${process.pid}.tmp`;
	const handle = fs.openSync(temporary, "w", 0o600);
	try {
		fs.writeFileSync(handle, `${JSON.stringify(value)}\n`);
		fs.fsyncSync(handle);
	} finally {
		fs.closeSync(handle);
	}
	fs.renameSync(temporary, file);
	const directoryHandle = fs.openSync(directory, "r");
	try {
		fs.fsyncSync(directoryHandle);
	} finally {
		fs.closeSync(directoryHandle);
	}
}
export function isLatched(directory: string): boolean {
	return fs.existsSync(path.join(directory, LATCH_FILE));
}
export function saveJournal(directory: string, journal: RecoveryJournal): void {
	if (isLatched(directory)) throw new Error("admission is latched closed");
	try {
		durableWrite(path.join(directory, JOURNAL_FILE), journal);
	} catch (error) {
		latch(
			directory,
			error instanceof Error ? error.message : "persistence failure",
		);
		throw error;
	}
}
export function loadJournal(directory: string): RecoveryJournal {
	const parsed: unknown = JSON.parse(
		fs.readFileSync(path.join(directory, JOURNAL_FILE), "utf8"),
	);
	if (
		!isRecord(parsed) ||
		!isRecord(parsed.authority) ||
		!isRecord(parsed.checkpoint) ||
		!Array.isArray(parsed.effects) ||
		!Array.isArray(parsed.followUps)
	)
		throw new Error("invalid recovery journal");
	return {
		...parsed,
		checkpoint: validateCheckpoint(parsed.checkpoint),
	} as RecoveryJournal;
}
export function saveReceipts(directory: string, receipts: Receipts): void {
	durableWrite(path.join(directory, RECEIPTS_FILE), receipts);
}
export function loadReceipts(directory: string): Receipts {
	const file = path.join(directory, RECEIPTS_FILE);
	if (!fs.existsSync(file)) return {};
	const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
	if (!isRecord(value)) throw new Error("invalid receipts");
	return value as Receipts;
}
export function assertAuthority(expected: Authority, actual: Authority): void {
	if (
		expected.incarnation !== actual.incarnation ||
		expected.epoch !== actual.epoch ||
		expected.attempt !== actual.attempt
	)
		throw new Error("stale recovery authority");
}
function snapshot(
	manager: SessionManager,
	checkpoint: RecoveryCheckpoint,
): RecoveryCheckpoint {
	const header = manager.getHeader();
	const leafId = manager.getLeafId();
	if (!header || !leafId) throw new Error("session snapshot is incomplete");
	return {
		...checkpoint,
		fileEntries: structuredClone([header, ...manager.getEntries()]),
		leafId,
	};
}
export interface RecoverResult {
	status: "continued" | "blocked" | "terminal";
	providerCalls: number;
	receipts: Receipts;
	terminalContent?: string;
	providerMessages?: Message[];
}

interface OfflineSessionOptions {
	checkpoint: RecoveryCheckpoint;
	imageOwnedCwd: string;
	agentDir: string;
	responses: FauxResponseStep[];
	extensionFactories?: (manager: SessionManager) => ExtensionFactory[];
	tools?: ToolDefinition[];
}

async function createOfflineSession(options: OfflineSessionOptions) {
	const workingEntries = structuredClone(options.checkpoint.fileEntries);
	const manager = SessionManager.inMemory(
		options.imageOwnedCwd,
		undefined,
		workingEntries,
	);
	manager.branch(options.checkpoint.leafId);
	const settingsManager = SettingsManager.inMemory({
		compaction: options.checkpoint.settings.compaction,
		retry: options.checkpoint.settings.retry,
	});
	fs.mkdirSync(options.agentDir, { recursive: true });
	const resourceLoader = new DefaultResourceLoader({
		cwd: options.imageOwnedCwd,
		agentDir: options.agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPrompt: "Offline recovery fixture.",
		extensionFactories: options.extensionFactories?.(manager) ?? [],
	});
	await resourceLoader.reload();
	const provider = fauxProvider({
		api: "faux",
		provider: "offline",
		models: [{ id: "offline-1", name: "Offline fixture", reasoning: false }],
	});
	provider.setResponses(options.responses);
	const modelRuntime = await ModelRuntime.create({
		modelsPath: null,
		refreshOnCreate: false,
	});
	modelRuntime.registerNativeProvider(provider.provider);
	const { session } = await createAgentSession({
		cwd: options.imageOwnedCwd,
		agentDir: options.agentDir,
		model: provider.getModel(),
		thinkingLevel: "off",
		modelRuntime,
		resourceLoader,
		sessionManager: manager,
		settingsManager,
		tools: options.tools?.map((tool) => tool.name) ?? [],
		customTools: options.tools,
	});
	return { session, provider };
}

function getTerminalContent(manager: SessionManager): string | undefined {
	const last = manager.buildSessionContext().messages.at(-1);
	if (last?.role !== "assistant" || last.stopReason !== "stop")
		return undefined;
	return last.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
}

function authenticResult(
	journal: RecoveryJournal,
	effect: JournalEffect,
): ToolResultMessage {
	const matches = journal.checkpoint.actualToolResults.filter(
		(result) => result.toolCallId === effect.toolCallId,
	);
	if (matches.length !== 1) throw new Error("recorded effect needs one result");
	return structuredClone(matches[0]);
}

function makeResult(effect: JournalEffect, output: string): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: effect.toolCallId,
		toolName: effect.toolName,
		content: [{ type: "text", text: output }],
		isError: false,
		timestamp: Date.now(),
	};
}
export function runRemoteEffect(
	directory: string,
	journal: RecoveryJournal,
	effect: JournalEffect,
	expected: Authority,
): ToolResultMessage {
	assertAuthority(expected, journal.authority);
	if (
		effect.runId !== journal.runId ||
		effect.assistantEntryId !== journal.assistantEntryId ||
		journal.checkpoint.leafId !== journal.assistantEntryId
	)
		throw new Error("execution position mismatch");
	if (effect.state !== "admitted") throw new Error("effect is not admitted");
	const receipts = loadReceipts(directory);
	if (receipts[effect.toolCallId])
		throw new Error("admitted effect already has an uncertain receipt");
	const n = effect.arguments.n;
	if (typeof n !== "number") throw new Error("invalid remote arguments");
	const output = `${effect.toolName}:${n}`;
	receipts[effect.toolCallId] = { count: 1, output };
	saveReceipts(directory, receipts);
	return makeResult(effect, output);
}
export async function recoverCommittedBatch(
	directory: string,
	cwd: string,
	expected: Authority,
): Promise<RecoverResult> {
	if (isLatched(directory))
		return {
			status: "blocked",
			providerCalls: 0,
			receipts: loadReceipts(directory),
		};
	const journal = loadJournal(directory);
	assertAuthority(expected, journal.authority);
	if (
		journal.checkpoint.terminal &&
		journal.followUps.length === journal.consumedCommandIds.length
	)
		return {
			status: "terminal",
			providerCalls: 0,
			receipts: loadReceipts(directory),
			terminalContent: journal.checkpoint.terminalContent,
		};
	if (
		journal.effects.some(
			(effect) =>
				effect.state === "outcome_unknown" || effect.state === "admitted",
		)
	)
		return {
			status: "blocked",
			providerCalls: 0,
			receipts: loadReceipts(directory),
		};
	for (const effect of journal.effects) {
		if (effect.state !== "prepared") continue;
		effect.state = "admitted";
		saveJournal(directory, journal);
		let result: ToolResultMessage;
		try {
			result = runRemoteEffect(directory, journal, effect, expected);
		} catch (error) {
			effect.state = "outcome_unknown";
			try {
				saveJournal(directory, journal);
			} catch {}
			throw error;
		}
		effect.result = { content: result.content, isError: result.isError };
		effect.state = "result_recorded";
		journal.checkpoint.actualToolResults.push(result);
		saveJournal(directory, journal);
	}
	const restored = restoreValidatedCheckpoint(journal.checkpoint, cwd);
	for (const effect of journal.effects) {
		if (effect.state !== "result_recorded") continue;
		const result = authenticResult(journal, effect);
		effect.piEntryId = restored.sessionManager.appendMessage(result);
		effect.state = "materialized";
		journal.checkpoint = snapshot(restored.sessionManager, journal.checkpoint);
		saveJournal(directory, journal);
	}
	const next = journal.followUps.find(
		(item) => !journal.consumedCommandIds.includes(item.commandId),
	);
	if (next) {
		restored.sessionManager.appendMessage({
			role: "user",
			content: next.text,
			timestamp: Date.now(),
		});
		journal.checkpoint = snapshot(restored.sessionManager, journal.checkpoint);
		journal.consumedCommandIds.push(next.commandId);
		journal.checkpoint.consumedCommandIds = [...journal.consumedCommandIds];
		saveJournal(directory, journal);
	}
	const remaining = journal.followUps.some(
		(item) => !journal.consumedCommandIds.includes(item.commandId),
	);
	const providerContexts: Message[][] = [];
	const offline = await createOfflineSession({
		checkpoint: snapshot(restored.sessionManager, journal.checkpoint),
		imageOwnedCwd: cwd,
		agentDir: path.join(directory, "agent"),
		responses: [
			(context: Context) => {
				providerContexts.push(structuredClone(context.messages));
				return fauxAssistantMessage(fauxText("provider continuation complete"));
			},
		],
	});
	try {
		await offline.session.agent.continue();
		journal.checkpoint = snapshot(
			offline.session.sessionManager,
			journal.checkpoint,
		);
		journal.checkpoint.terminal = !remaining;
		journal.checkpoint.terminalContent = getTerminalContent(
			offline.session.sessionManager,
		);
		saveJournal(directory, journal);
	} finally {
		offline.session.dispose();
	}
	return {
		status: remaining ? "continued" : "terminal",
		providerCalls: offline.provider.state.callCount,
		receipts: loadReceipts(directory),
		terminalContent: journal.checkpoint.terminalContent,
		providerMessages: providerContexts.at(-1),
	};
}
export const BARRIER_NAMES = [
	"initial-command",
	"follow-up",
	"assistant-tools",
	"tool-result",
	"final-answer",
	"compaction",
	"extension-state",
	"spending-attempt",
] as const;
export type BarrierName = (typeof BARRIER_NAMES)[number];
export type SpendingAttemptKind =
	| "provider"
	| "retry"
	| "compaction"
	| "metadata";
export type CrashPosition =
	| "before-persist"
	| "after-persist-before-ack"
	| "after-ack-before-next";

type BarrierPointHandler = (point: CrashPosition) => void;

function persistSemanticState(
	directory: string,
	mutate: (journal: RecoveryJournal) => void,
	onPoint?: BarrierPointHandler,
): RecoveryJournal {
	onPoint?.("before-persist");
	const journal = loadJournal(directory);
	mutate(journal);
	saveJournal(directory, journal);
	onPoint?.("after-persist-before-ack");
	onPoint?.("after-ack-before-next");
	return journal;
}

function appendUserCommand(
	directory: string,
	command: FollowUp,
	kind: "initial" | "follow-up",
	onPoint?: BarrierPointHandler,
): void {
	const current = loadJournal(directory);
	if (current.consumedCommandIds.includes(command.commandId)) return;
	const header = current.checkpoint.fileEntries[0];
	if (header?.type !== "session")
		throw new Error("checkpoint header is absent");
	persistSemanticState(
		directory,
		(journal) => {
			const restored = restoreValidatedCheckpoint(
				journal.checkpoint,
				header.cwd,
			);
			const userEntryId = restored.sessionManager.appendMessage({
				role: "user",
				content: command.text,
				timestamp: Date.now(),
			});
			journal.checkpoint = snapshot(
				restored.sessionManager,
				journal.checkpoint,
			);
			if (!journal.acceptedCommandIds.includes(command.commandId))
				journal.acceptedCommandIds.push(command.commandId);
			journal.consumedCommandIds.push(command.commandId);
			journal.checkpoint.acceptedCommandIds = [...journal.acceptedCommandIds];
			journal.checkpoint.consumedCommandIds = [...journal.consumedCommandIds];
			if (kind === "initial")
				journal.initialCommand = { commandId: command.commandId, userEntryId };
		},
		onPoint,
	);
}

export function consumeInitialCommand(
	directory: string,
	command: FollowUp,
	onPoint?: BarrierPointHandler,
): void {
	appendUserCommand(directory, command, "initial", onPoint);
}

export function consumeOneFollowUp(
	directory: string,
	onPoint?: BarrierPointHandler,
): void {
	const journal = loadJournal(directory);
	const next = journal.followUps.find(
		(command) => !journal.consumedCommandIds.includes(command.commandId),
	);
	if (next) appendUserCommand(directory, next, "follow-up", onPoint);
}

function assistantToolCalls(message: AssistantMessage) {
	return message.content.filter((block) => block.type === "toolCall");
}

export function persistAssistantResponseBeforeDispatch(
	directory: string,
	manager: SessionManager,
	message: AssistantMessage,
	onPoint?: BarrierPointHandler,
): void {
	const current = loadJournal(directory);
	if (current.assistantResponseEntryId) return;
	persistSemanticState(
		directory,
		(journal) => {
			const calls = assistantToolCalls(message);
			const entry = [...manager.getEntries()]
				.reverse()
				.find(
					(candidate) =>
						candidate.type === "message" &&
						candidate.message.role === "assistant" &&
						calls.every((call) =>
							candidate.message.role === "assistant"
								? candidate.message.content.some(
										(block) =>
											block.type === "toolCall" && block.id === call.id,
									)
								: false,
						),
				);
			if (entry?.type !== "message")
				throw new Error(
					"Pi tool_call ran before its assistant entry was available",
				);
			journal.assistantEntryId = entry.id;
			journal.assistantResponseEntryId = entry.id;
			journal.checkpoint = snapshot(manager, journal.checkpoint);
			if (
				!journal.checkpoint.committedProviderResponses.some(
					(response) =>
						assistantToolCalls(response)
							.map((call) => call.id)
							.join("\0") === calls.map((call) => call.id).join("\0"),
				)
			)
				journal.checkpoint.committedProviderResponses.push(
					structuredClone(message),
				);
			for (const call of calls)
				if (!journal.effects.some((effect) => effect.toolCallId === call.id))
					journal.effects.push({
						runId: journal.runId,
						assistantEntryId: entry.id,
						toolCallId: call.id,
						toolName: call.name,
						arguments: structuredClone(call.arguments),
						state: "prepared",
					});
		},
		onPoint,
	);
}

export function admitPreparedTool(directory: string, toolCallId: string): void {
	const journal = loadJournal(directory);
	const effect = journal.effects.find((item) => item.toolCallId === toolCallId);
	if (!effect) throw new Error("tool call is absent from committed response");
	if (effect.state !== "prepared") return;
	effect.state = "admitted";
	saveJournal(directory, journal);
}

export function persistToolResultFromHook(
	directory: string,
	result: ToolResultMessage,
	onPoint?: BarrierPointHandler,
): void {
	const current = loadJournal(directory);
	const existing = current.effects.find(
		(effect) => effect.toolCallId === result.toolCallId,
	);
	if (
		existing?.state === "result_recorded" ||
		existing?.state === "materialized"
	)
		return;
	persistSemanticState(
		directory,
		(journal) => {
			const effect = journal.effects.find(
				(item) => item.toolCallId === result.toolCallId,
			);
			if (!effect || effect.state !== "admitted")
				throw new Error("tool result has no admitted effect");
			effect.result = {
				content: structuredClone(result.content),
				isError: result.isError,
			};
			effect.state = "result_recorded";
			journal.checkpoint.actualToolResults.push(structuredClone(result));
		},
		onPoint,
	);
}

function reconcileMaterializedResults(journal: RecoveryJournal): void {
	for (const effect of journal.effects) {
		const entry = journal.checkpoint.fileEntries.find(
			(candidate) =>
				candidate.type === "message" &&
				candidate.message.role === "toolResult" &&
				candidate.message.toolCallId === effect.toolCallId,
		);
		if (entry?.type !== "message") continue;
		effect.piEntryId = entry.id;
		effect.state = "materialized";
	}
}

export function persistFinalAnswerAfterRunPromise(
	directory: string,
	manager: SessionManager,
	runSettled: boolean,
	onPoint?: BarrierPointHandler,
): void {
	if (!runSettled)
		throw new Error("final answer cannot precede the public run promise");
	const current = loadJournal(directory);
	if (current.checkpoint.terminal) return;
	persistSemanticState(
		directory,
		(journal) => {
			const content = getTerminalContent(manager);
			if (content === undefined)
				throw new Error("public run did not finish with an answer");
			journal.checkpoint = snapshot(manager, journal.checkpoint);
			journal.checkpoint.terminal = true;
			journal.checkpoint.terminalContent = content;
			reconcileMaterializedResults(journal);
		},
		onPoint,
	);
}

export function persistCompactionFromHook(
	directory: string,
	manager: SessionManager,
	compactionEntryId: string,
	onPoint?: BarrierPointHandler,
): void {
	const current = loadJournal(directory);
	if (current.compactionEntryId) return;
	persistSemanticState(
		directory,
		(journal) => {
			const entry = manager.getEntry(compactionEntryId);
			if (entry?.type !== "compaction")
				throw new Error("session_compact did not provide a saved compaction");
			journal.checkpoint = snapshot(manager, journal.checkpoint);
			journal.compactionEntryId = entry.id;
		},
		onPoint,
	);
}

export function persistExtensionStateTransition(
	directory: string,
	toolCallId: string,
	phase: string,
	onPoint?: BarrierPointHandler,
): void {
	const current = loadJournal(directory);
	if (
		current.extensionTransitions?.some(
			(transition) => transition.toolCallId === toolCallId,
		)
	)
		return;
	persistSemanticState(
		directory,
		(journal) => {
			journal.checkpoint.extensionState = { phase, toolCallId };
			journal.extensionTransitions = [
				...(journal.extensionTransitions ?? []),
				{ toolCallId, phase, leafId: journal.checkpoint.leafId },
			];
		},
		onPoint,
	);
}

export function admitSpendingAttempt(
	directory: string,
	kind: SpendingAttemptKind,
	sequence: number,
	onPoint?: BarrierPointHandler,
): void {
	const current = loadJournal(directory);
	if (
		current.spendingAttempts?.some(
			(attempt) => attempt.kind === kind && attempt.sequence === sequence,
		)
	)
		return;
	persistSemanticState(
		directory,
		(journal) => {
			journal.spendingAttempts = [
				...(journal.spendingAttempts ?? []),
				{ kind, sequence },
			];
		},
		onPoint,
	);
}

const remoteToolParameters = Type.Object(
	{ n: Type.Number() },
	{ additionalProperties: false },
);

function createRemoteTools(
	directory: string,
	expected: Authority,
): Array<ToolDefinition<typeof remoteToolParameters>> {
	return ["tool_a", "tool_b"].map((name) => ({
		name,
		label: name,
		description: `Offline ${name}`,
		parameters: remoteToolParameters,
		executionMode: "sequential",
		execute: async (toolCallId, arguments_) => {
			const journal = loadJournal(directory);
			const effect = journal.effects.find(
				(item) => item.toolCallId === toolCallId,
			);
			if (!effect) throw new Error("tool is not in the committed response");
			if (arguments_.n !== effect.arguments.n)
				throw new Error("validated tool arguments changed");
			const result = runRemoteEffect(directory, journal, effect, expected);
			return { content: result.content, details: {} };
		},
	}));
}

async function continueAndPersistFinal(
	directory: string,
	imageOwnedCwd: string,
	content: string,
	onPoint?: BarrierPointHandler,
): Promise<number> {
	const journal = loadJournal(directory);
	if (journal.checkpoint.terminal) return 0;
	const offline = await createOfflineSession({
		checkpoint: journal.checkpoint,
		imageOwnedCwd,
		agentDir: path.join(directory, "agent"),
		responses: [fauxAssistantMessage(fauxText(content))],
	});
	let runSettled = false;
	try {
		await offline.session.agent.continue();
		runSettled = true;
		persistFinalAnswerAfterRunPromise(
			directory,
			offline.session.sessionManager,
			runSettled,
			onPoint,
		);
		return offline.provider.state.callCount;
	} finally {
		offline.session.dispose();
	}
}

function recoverKnownToolBoundary(
	directory: string,
): "blocked" | "recover" | "run" {
	const journal = loadJournal(directory);
	for (const effect of journal.effects) {
		if (effect.state !== "admitted") continue;
		if (loadReceipts(directory)[effect.toolCallId]) {
			effect.state = "outcome_unknown";
			saveJournal(directory, journal);
			return "blocked";
		}
	}
	if (journal.assistantResponseEntryId) return "recover";
	return "run";
}

async function runToolBarrierScenario(
	directory: string,
	imageOwnedCwd: string,
	barrier: "assistant-tools" | "tool-result" | "extension-state",
	expected: Authority,
	onPoint?: BarrierPointHandler,
	failToolResultPersistence = false,
): Promise<RecoverResult> {
	const boundary = recoverKnownToolBoundary(directory);
	if (boundary === "blocked" || isLatched(directory))
		return {
			status: "blocked",
			providerCalls: 0,
			receipts: loadReceipts(directory),
		};
	if (boundary === "recover") {
		if (barrier === "extension-state")
			persistExtensionStateTransition(
				directory,
				"call-a",
				"authorized",
				onPoint,
			);
		return recoverCommittedBatch(directory, imageOwnedCwd, expected);
	}
	let latestAssistant: AssistantMessage | undefined;
	let providerCalls = 0;
	const journal = loadJournal(directory);
	const offline = await createOfflineSession({
		checkpoint: journal.checkpoint,
		imageOwnedCwd,
		agentDir: path.join(directory, "agent"),
		responses: [
			fauxAssistantMessage(
				[
					fauxToolCall("tool_a", { n: 1 }, { id: "call-a" }),
					fauxToolCall("tool_b", { n: 2 }, { id: "call-b" }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(fauxText("tool run complete")),
		],
		tools: createRemoteTools(directory, expected),
		extensionFactories: (manager) => [
			(pi) => {
				pi.on("message_end", (event) => {
					if (
						event.message.role === "assistant" &&
						event.message.content.some((block) => block.type === "toolCall")
					)
						latestAssistant = structuredClone(event.message);
				});
				pi.on("tool_call", (event) => {
					if (isLatched(directory))
						return {
							block: true,
							reason: "durability admission is latched",
							terminate: true,
						};
					if (!latestAssistant)
						throw new Error("tool_call preceded the assistant response");
					persistAssistantResponseBeforeDispatch(
						directory,
						manager,
						latestAssistant,
						barrier === "assistant-tools" ? onPoint : undefined,
					);
					if (barrier === "extension-state")
						persistExtensionStateTransition(
							directory,
							event.toolCallId,
							"authorized",
							onPoint,
						);
					admitPreparedTool(directory, event.toolCallId);
				});
				pi.on("tool_result", (event) => {
					const content = [
						{
							type: "text" as const,
							text: `normalized:${event.toolName}:${String(event.input.n)}`,
						},
					];
					if (failToolResultPersistence) {
						const temporary = path.join(
							directory,
							`${JOURNAL_FILE}.${process.pid}.tmp`,
						);
						fs.mkdirSync(temporary, { recursive: true });
					}
					persistToolResultFromHook(
						directory,
						{
							role: "toolResult",
							toolCallId: event.toolCallId,
							toolName: event.toolName,
							content,
							isError: false,
							timestamp: Date.now(),
						},
						barrier === "tool-result" ? onPoint : undefined,
					);
					return { content, isError: false };
				});
			},
		],
	});
	const baseStream = offline.session.agent.streamFunction;
	offline.session.agent.streamFunction = (model, context, options) => {
		if (isLatched(directory))
			throw new Error("durability admission is latched");
		return baseStream(model, context, options);
	};
	let runSettled = false;
	try {
		await offline.session.agent.continue();
		runSettled = true;
		providerCalls = offline.provider.state.callCount;
		if (!isLatched(directory))
			persistFinalAnswerAfterRunPromise(
				directory,
				offline.session.sessionManager,
				runSettled,
			);
	} finally {
		offline.session.dispose();
	}
	return {
		status: isLatched(directory) ? "blocked" : "terminal",
		providerCalls,
		receipts: loadReceipts(directory),
		terminalContent: loadJournal(directory).checkpoint.terminalContent,
	};
}

async function runCompactionBarrierScenario(
	directory: string,
	imageOwnedCwd: string,
	onPoint?: BarrierPointHandler,
): Promise<void> {
	const current = loadJournal(directory);
	if (current.compactionEntryId) return;
	const restored = restoreValidatedCheckpoint(
		current.checkpoint,
		imageOwnedCwd,
	);
	for (let index = 0; index < 3; index += 1) {
		restored.sessionManager.appendMessage({
			role: "user",
			content: `compaction input ${index} ${"x".repeat(80)}`,
			timestamp: Date.now() + index,
		});
		restored.sessionManager.appendMessage(
			fauxAssistantMessage(
				fauxText(`compaction answer ${index} ${"y".repeat(80)}`),
			),
		);
	}
	const checkpoint = snapshot(restored.sessionManager, current.checkpoint);
	checkpoint.settings.compaction = {
		enabled: true,
		reserveTokens: 1,
		keepRecentTokens: 1,
	};
	const offline = await createOfflineSession({
		checkpoint,
		imageOwnedCwd,
		agentDir: path.join(directory, "agent"),
		responses: [],
		extensionFactories: (manager) => [
			(pi) => {
				pi.on("session_before_compact", (event) => ({
					compaction: {
						summary: "hook-owned compaction summary",
						firstKeptEntryId: event.preparation.firstKeptEntryId,
						tokensBefore: event.preparation.tokensBefore,
					},
				}));
				pi.on("session_compact", (event) => {
					persistCompactionFromHook(
						directory,
						manager,
						event.compactionEntry.id,
						onPoint,
					);
				});
			},
		],
	});
	try {
		await offline.session.compact();
	} finally {
		offline.session.dispose();
	}
}

async function runSpendingBarrierScenario(
	directory: string,
	imageOwnedCwd: string,
	onPoint?: BarrierPointHandler,
): Promise<void> {
	const current = loadJournal(directory);
	const kinds: SpendingAttemptKind[] = [
		"provider",
		"retry",
		"compaction",
		"metadata",
	];
	const offline = await createOfflineSession({
		checkpoint: current.checkpoint,
		imageOwnedCwd,
		agentDir: path.join(directory, "agent"),
		responses: kinds.map((kind) =>
			fauxAssistantMessage(fauxText(`${kind} response`)),
		),
	});
	const baseStream = offline.session.agent.streamFunction;
	const model = offline.session.model;
	if (!model) throw new Error("offline session model is absent");
	try {
		for (const [index, kind] of kinds.entries()) {
			admitSpendingAttempt(directory, kind, index + 1, onPoint);
			const messages = await offline.session.agent.convertToLlm(
				offline.session.messages,
			);
			const context: Context = {
				systemPrompt: offline.session.systemPrompt,
				messages,
			};
			const stream = await baseStream(model, context, {
				sessionId: offline.session.sessionId,
			});
			await stream.result();
		}
	} finally {
		offline.session.dispose();
	}
}

export async function runBarrierScenario(
	directory: string,
	imageOwnedCwd: string,
	barrier: BarrierName,
	expected: Authority,
	onPoint?: BarrierPointHandler,
): Promise<void> {
	if (barrier === "initial-command") {
		consumeInitialCommand(
			directory,
			{ commandId: "cmd-initial", text: "initial instruction" },
			onPoint,
		);
		await continueAndPersistFinal(directory, imageOwnedCwd, "initial complete");
		return;
	}
	if (barrier === "follow-up") {
		consumeOneFollowUp(directory, onPoint);
		await continueAndPersistFinal(
			directory,
			imageOwnedCwd,
			"follow-up complete",
		);
		return;
	}
	if (
		barrier === "assistant-tools" ||
		barrier === "tool-result" ||
		barrier === "extension-state"
	) {
		await runToolBarrierScenario(
			directory,
			imageOwnedCwd,
			barrier,
			expected,
			onPoint,
		);
		return;
	}
	if (barrier === "final-answer") {
		await continueAndPersistFinal(
			directory,
			imageOwnedCwd,
			"final answer",
			onPoint,
		);
		return;
	}
	if (barrier === "compaction") {
		await runCompactionBarrierScenario(directory, imageOwnedCwd, onPoint);
		return;
	}
	await runSpendingBarrierScenario(directory, imageOwnedCwd, onPoint);
}

export async function runLiveToolPersistenceFailure(
	directory: string,
	imageOwnedCwd: string,
	expected: Authority,
): Promise<RecoverResult> {
	return runToolBarrierScenario(
		directory,
		imageOwnedCwd,
		"tool-result",
		expected,
		undefined,
		true,
	);
}
