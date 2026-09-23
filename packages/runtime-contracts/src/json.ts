import { RUNTIME_LIMITS } from "./limits.js";

export class ContractParseError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "ContractParseError";
	}
}

const encoder = new TextEncoder();

export function encodedBytes(value: unknown): number {
	let encoded: string | undefined;
	try {
		encoded = JSON.stringify(value);
	} catch {
		throw new ContractParseError(
			"invalid_json",
			"Value is not JSON serializable.",
		);
	}
	if (encoded === undefined) {
		throw new ContractParseError(
			"invalid_json",
			"Value is not JSON serializable.",
		);
	}
	return encoder.encode(encoded).byteLength;
}

export function decodeJsonText(text: string, maxBytes: number): unknown {
	if (encoder.encode(text).byteLength > maxBytes) {
		throw new ContractParseError(
			"contract_too_large",
			"JSON exceeds its byte limit.",
		);
	}
	const parser = new StrictJsonParser(text);
	const value = parser.parseValue();
	parser.skipWs();
	if (!parser.done()) {
		throw new ContractParseError("invalid_json", "Trailing JSON content.");
	}
	return value;
}

export function decodeContractInput(value: unknown, maxBytes: number): unknown {
	if (typeof value === "string") {
		return decodeJsonText(value, maxBytes);
	}
	if (encodedBytes(value) > maxBytes) {
		throw new ContractParseError(
			"contract_too_large",
			"Value exceeds its byte limit.",
		);
	}
	return value;
}

function ownProperty(
	record: Record<string, unknown>,
	key: string,
	value: unknown,
): void {
	Object.defineProperty(record, key, {
		value,
		enumerable: true,
		writable: true,
		configurable: true,
	});
}

class StrictJsonParser {
	private readonly input: string;
	private index = 0;

	constructor(input: string) {
		this.input = input;
	}

	private enter(depth: number): number {
		if (depth >= RUNTIME_LIMITS.jsonMaxNesting) {
			throw new ContractParseError(
				"invalid_json",
				"JSON exceeds maximum nesting.",
			);
		}
		return depth + 1;
	}

	done(): boolean {
		return this.index >= this.input.length;
	}

	skipWs(): void {
		while (this.index < this.input.length) {
			const char = this.input.charCodeAt(this.index);
			if (char === 32 || char === 9 || char === 10 || char === 13) {
				this.index += 1;
				continue;
			}
			break;
		}
	}

	parseValue(depth = 0): unknown {
		this.skipWs();
		if (this.done()) {
			throw new ContractParseError("invalid_json", "Unexpected end of JSON.");
		}
		const char = this.input[this.index];
		if (char === "{") return this.parseObject(this.enter(depth));
		if (char === "[") return this.parseArray(this.enter(depth));
		if (char === '"') return this.parseString();
		if (char === "t") return this.parseLiteral("true", true);
		if (char === "f") return this.parseLiteral("false", false);
		if (char === "n") return this.parseLiteral("null", null);
		if (char === "-" || (char !== undefined && char >= "0" && char <= "9")) {
			return this.parseNumber();
		}
		throw new ContractParseError("invalid_json", "Malformed JSON value.");
	}

	private parseObject(depth: number): Record<string, unknown> {
		this.index += 1;
		this.skipWs();
		const record: Record<string, unknown> = {};
		const keys = new Set<string>();
		if (this.input[this.index] === "}") {
			this.index += 1;
			return record;
		}
		while (true) {
			this.skipWs();
			if (this.input[this.index] !== '"') {
				throw new ContractParseError(
					"invalid_json",
					"Object key must be a string.",
				);
			}
			const key = this.parseString();
			if (keys.has(key)) {
				throw new ContractParseError(
					"duplicate_field",
					`Duplicate JSON key ${key}.`,
				);
			}
			keys.add(key);
			this.skipWs();
			if (this.input[this.index] !== ":") {
				throw new ContractParseError(
					"invalid_json",
					"Expected colon after object key.",
				);
			}
			this.index += 1;
			ownProperty(record, key, this.parseValue(depth));
			this.skipWs();
			const separator = this.input[this.index];
			if (separator === ",") {
				this.index += 1;
				continue;
			}
			if (separator === "}") {
				this.index += 1;
				return record;
			}
			throw new ContractParseError("invalid_json", "Malformed JSON object.");
		}
	}

	private parseArray(depth: number): unknown[] {
		this.index += 1;
		this.skipWs();
		const items: unknown[] = [];
		if (this.input[this.index] === "]") {
			this.index += 1;
			return items;
		}
		while (true) {
			items.push(this.parseValue(depth));
			this.skipWs();
			const separator = this.input[this.index];
			if (separator === ",") {
				this.index += 1;
				continue;
			}
			if (separator === "]") {
				this.index += 1;
				return items;
			}
			throw new ContractParseError("invalid_json", "Malformed JSON array.");
		}
	}

	private parseString(): string {
		this.index += 1;
		let result = "";
		while (this.index < this.input.length) {
			const char = this.input[this.index];
			if (char === '"') {
				this.index += 1;
				return result;
			}
			if (char === "\\") {
				this.index += 1;
				result += this.parseEscape();
				continue;
			}
			if (char === undefined || char.charCodeAt(0) < 32) {
				throw new ContractParseError(
					"invalid_json",
					"Unescaped control character in string.",
				);
			}
			result += char;
			this.index += 1;
		}
		throw new ContractParseError("invalid_json", "Unterminated JSON string.");
	}

	private parseEscape(): string {
		const char = this.input[this.index];
		this.index += 1;
		switch (char) {
			case '"':
			case "\\":
			case "/":
				return char;
			case "b":
				return "\b";
			case "f":
				return "\f";
			case "n":
				return "\n";
			case "r":
				return "\r";
			case "t":
				return "\t";
			case "u": {
				const hex = this.input.slice(this.index, this.index + 4);
				if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
					throw new ContractParseError(
						"invalid_json",
						"Invalid Unicode escape.",
					);
				}
				this.index += 4;
				return String.fromCharCode(Number.parseInt(hex, 16));
			}
			default:
				throw new ContractParseError("invalid_json", "Invalid JSON escape.");
		}
	}

	private parseLiteral(
		expected: string,
		value: boolean | null,
	): boolean | null {
		if (
			this.input.slice(this.index, this.index + expected.length) !== expected
		) {
			throw new ContractParseError("invalid_json", "Malformed JSON literal.");
		}
		this.index += expected.length;
		return value;
	}

	private parseNumber(): number {
		const start = this.index;
		if (this.input[this.index] === "-") this.index += 1;
		if (this.input[this.index] === "0") {
			this.index += 1;
		} else if (
			this.input[this.index] !== undefined &&
			this.input[this.index] >= "1" &&
			this.input[this.index] <= "9"
		) {
			while (
				this.input[this.index] !== undefined &&
				this.input[this.index] >= "0" &&
				this.input[this.index] <= "9"
			) {
				this.index += 1;
			}
		} else {
			throw new ContractParseError("invalid_json", "Malformed JSON number.");
		}
		if (this.input[this.index] === ".") {
			this.index += 1;
			if (
				this.input[this.index] === undefined ||
				this.input[this.index] < "0" ||
				this.input[this.index] > "9"
			) {
				throw new ContractParseError("invalid_json", "Malformed JSON number.");
			}
			while (
				this.input[this.index] !== undefined &&
				this.input[this.index] >= "0" &&
				this.input[this.index] <= "9"
			) {
				this.index += 1;
			}
		}
		if (this.input[this.index] === "e" || this.input[this.index] === "E") {
			this.index += 1;
			if (this.input[this.index] === "+" || this.input[this.index] === "-") {
				this.index += 1;
			}
			if (
				this.input[this.index] === undefined ||
				this.input[this.index] < "0" ||
				this.input[this.index] > "9"
			) {
				throw new ContractParseError("invalid_json", "Malformed JSON number.");
			}
			while (
				this.input[this.index] !== undefined &&
				this.input[this.index] >= "0" &&
				this.input[this.index] <= "9"
			) {
				this.index += 1;
			}
		}
		const raw = this.input.slice(start, this.index);
		const value = Number(raw);
		if (!Number.isFinite(value)) {
			throw new ContractParseError(
				"invalid_json",
				"JSON number is not finite.",
			);
		}
		return value;
	}
}

export function strictRecord(
	value: unknown,
	keys: readonly string[],
	contract: string,
): Record<string, unknown> {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		throw new ContractParseError(
			"invalid_object",
			`${contract} must be a plain object.`,
		);
	}
	const record = value as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		if (!keys.includes(key)) {
			throw new ContractParseError(
				"unknown_field",
				`${contract} contains unknown field ${key}.`,
			);
		}
	}
	return record;
}

export function stringField(
	record: Record<string, unknown>,
	key: string,
	options: {
		optional: true;
		maxBytes?: number;
		maxCharacters?: number;
	},
): string | undefined;
export function stringField(
	record: Record<string, unknown>,
	key: string,
	options?: {
		optional?: false;
		maxBytes?: number;
		maxCharacters?: number;
	},
): string;
export function stringField(
	record: Record<string, unknown>,
	key: string,
	options: {
		optional?: boolean;
		maxBytes?: number;
		maxCharacters?: number;
	} = {},
): string | undefined {
	const value = record[key];
	if (value === undefined && options.optional) return undefined;
	if (typeof value !== "string" || value.length === 0) {
		throw new ContractParseError(
			"invalid_field",
			`${key} must be a non-empty string.`,
		);
	}
	if (
		options.maxCharacters !== undefined &&
		value.length > options.maxCharacters
	) {
		throw new ContractParseError(
			"field_too_large",
			`${key} exceeds its character limit.`,
		);
	}
	const maxBytes = options.maxBytes;
	if (maxBytes !== undefined && encoder.encode(value).byteLength > maxBytes) {
		throw new ContractParseError(
			"field_too_large",
			`${key} exceeds its byte limit.`,
		);
	}
	return value;
}

export function literalField<T extends string | number>(
	record: Record<string, unknown>,
	key: string,
	values: readonly T[],
): T {
	const value = record[key];
	if (!values.includes(value as T)) {
		throw new ContractParseError("invalid_field", `${key} is invalid.`);
	}
	return value as T;
}

export function optionalLiteralField<T extends string>(
	record: Record<string, unknown>,
	key: string,
	values: readonly T[],
): T | undefined {
	return record[key] === undefined
		? undefined
		: literalField(record, key, values);
}

export function integerField(
	record: Record<string, unknown>,
	key: string,
	options: { optional: true; minimum?: number; maximum?: number },
): number | undefined;
export function integerField(
	record: Record<string, unknown>,
	key: string,
	options?: { optional?: false; minimum?: number; maximum?: number },
): number;
export function integerField(
	record: Record<string, unknown>,
	key: string,
	options: { optional?: boolean; minimum?: number; maximum?: number } = {},
): number | undefined {
	const value = record[key];
	if (value === undefined && options.optional) return undefined;
	if (!Number.isSafeInteger(value)) {
		throw new ContractParseError(
			"invalid_integer",
			`${key} must be a safe integer.`,
		);
	}
	const integer = value as number;
	if (options.minimum !== undefined && integer < options.minimum) {
		throw new ContractParseError(
			"invalid_integer",
			`${key} must be a safe integer >= ${options.minimum}.`,
		);
	}
	if (options.maximum !== undefined && integer > options.maximum) {
		throw new ContractParseError(
			"invalid_integer",
			`${key} must be a safe integer <= ${options.maximum}.`,
		);
	}
	return integer;
}
