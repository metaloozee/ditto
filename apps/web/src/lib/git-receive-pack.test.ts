import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeFlushPkt, encodePktLine } from "./git-pkt-line";
import {
	extractAdvertisedOldOid,
	GitReceivePackError,
	MAX_RECEIVE_PACK_PREFIX_BYTES,
	MAX_REPORT_STATUS_BYTES,
	parseReceivePackCommands,
	parseReportStatus,
	splitReceivePackBody,
	ZERO_OID,
} from "./git-receive-pack";

const NEW_OID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OLD_OID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const REF = "refs/heads/ditto/session-1";
const CAPS =
	"report-status-v2 side-band-64k quiet object-format=sha1 agent=git/2.52.0-Linux";

function concatBytes(...parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

function commandPrefix(options?: {
	oldOid?: string;
	newOid?: string;
	ref?: string;
	caps?: string;
	extra?: Uint8Array;
}): Uint8Array {
	const oldOid = options?.oldOid ?? ZERO_OID;
	const newOid = options?.newOid ?? NEW_OID;
	const ref = options?.ref ?? REF;
	const caps = options?.caps ?? CAPS;
	return concatBytes(
		encodePktLine(`${oldOid} ${newOid} ${ref}\0 ${caps}\n`),
		encodeFlushPkt(),
		options?.extra ?? new Uint8Array(0),
	);
}

function httpAdvertisement(refLines: Uint8Array[]): Uint8Array {
	return concatBytes(
		encodePktLine("# service=git-receive-pack\n"),
		encodeFlushPkt(),
		...refLines,
		encodeFlushPkt(),
	);
}

function bytesStream(
	bytes: Uint8Array,
	chunkSize = bytes.byteLength,
): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			if (bytes.byteLength === 0) {
				controller.close();
				return;
			}
			for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
				controller.enqueue(bytes.subarray(offset, offset + chunkSize));
			}
			controller.close();
		},
	});
}

async function readAll(
	stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
	const parts: Uint8Array[] = [];
	const reader = stream.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		if (value) {
			parts.push(value);
		}
	}
	return concatBytes(...parts);
}

function gitAdvertisementFixture(): { oldOid: string; bytes: Uint8Array } {
	const root = mkdtempSync(join(tmpdir(), "ditto-receive-pack-"));
	try {
		execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "pipe" });
		execFileSync("git", ["config", "user.email", "test@example.com"], {
			cwd: root,
			stdio: "pipe",
		});
		execFileSync("git", ["config", "user.name", "Test"], {
			cwd: root,
			stdio: "pipe",
		});
		writeFileSync(join(root, "file.txt"), "one\n");
		execFileSync("git", ["add", "file.txt"], { cwd: root, stdio: "pipe" });
		execFileSync("git", ["commit", "-m", "one"], { cwd: root, stdio: "pipe" });
		const oldOid = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: root,
			encoding: "utf8",
		}).trim();
		const raw = execFileSync(
			"git",
			["receive-pack", "--advertise-refs", root],
			{
				encoding: "buffer",
			},
		);
		return { oldOid, bytes: new Uint8Array(raw) };
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

describe("git-receive-pack advertisement", () => {
	it("extracts the old OID for a create against an empty repo", () => {
		const bytes = httpAdvertisement([
			encodePktLine(
				`${ZERO_OID} capabilities^{}\0report-status report-status-v2 delete-refs side-band-64k quiet atomic ofs-delta object-format=sha1 agent=git/2.52.0-Linux\n`,
			),
		]);
		expect(extractAdvertisedOldOid(bytes, REF)).toBe(ZERO_OID);
	});

	it("extracts the advertised OID for a fast-forward ref", () => {
		const bytes = httpAdvertisement([
			encodePktLine(
				`${OLD_OID} ${REF}\0report-status report-status-v2 delete-refs side-band-64k quiet atomic ofs-delta object-format=sha1 agent=git/2.52.0-Linux\n`,
			),
			encodePktLine(`${NEW_OID} refs/heads/other\n`),
		]);
		expect(extractAdvertisedOldOid(bytes, REF)).toBe(OLD_OID);
	});

	it("reads a git-generated advertisement", () => {
		const fixture = gitAdvertisementFixture();
		expect(extractAdvertisedOldOid(fixture.bytes, "refs/heads/main")).toBe(
			fixture.oldOid,
		);
	});
});

describe("git-receive-pack commands", () => {
	it("parses a valid create", () => {
		const command = parseReceivePackCommands(commandPrefix(), {
			allowedRef: REF,
			newOid: NEW_OID,
			oldOid: ZERO_OID,
		});
		expect(command.oldOid).toBe(ZERO_OID);
		expect(command.newOid).toBe(NEW_OID);
		expect(command.ref).toBe(REF);
	});

	it("parses a valid fast-forward update", () => {
		const command = parseReceivePackCommands(
			commandPrefix({ oldOid: OLD_OID }),
			{
				allowedRef: REF,
				newOid: NEW_OID,
				oldOid: OLD_OID,
			},
		);
		expect(command.oldOid).toBe(OLD_OID);
	});

	it("rejects deletion", () => {
		expect(() =>
			parseReceivePackCommands(commandPrefix({ newOid: ZERO_OID }), {
				allowedRef: REF,
				newOid: ZERO_OID,
				oldOid: OLD_OID,
			}),
		).toThrow(GitReceivePackError);
		try {
			parseReceivePackCommands(commandPrefix({ newOid: ZERO_OID }), {
				allowedRef: REF,
				newOid: ZERO_OID,
				oldOid: OLD_OID,
			});
		} catch (error) {
			expect(error).toMatchObject({ code: "deletion" });
		}
	});

	it("rejects an extra ref", () => {
		const prefix = concatBytes(
			encodePktLine(`${ZERO_OID} ${NEW_OID} ${REF}\0 ${CAPS}\n`),
			encodePktLine(`${ZERO_OID} ${NEW_OID} refs/heads/other\n`),
			encodeFlushPkt(),
		);
		try {
			parseReceivePackCommands(prefix, {
				allowedRef: REF,
				newOid: NEW_OID,
				oldOid: ZERO_OID,
			});
			expect.unreachable();
		} catch (error) {
			expect(error).toMatchObject({ code: "extra_ref" });
		}
	});

	it("rejects the wrong branch", () => {
		try {
			parseReceivePackCommands(commandPrefix({ ref: "refs/heads/main" }), {
				allowedRef: REF,
				newOid: NEW_OID,
				oldOid: ZERO_OID,
			});
			expect.unreachable();
		} catch (error) {
			expect(error).toMatchObject({ code: "ref_denied" });
		}
	});

	it("rejects the wrong new SHA", () => {
		try {
			parseReceivePackCommands(commandPrefix(), {
				allowedRef: REF,
				newOid: OLD_OID,
				oldOid: ZERO_OID,
			});
			expect.unreachable();
		} catch (error) {
			expect(error).toMatchObject({ code: "new_oid_mismatch" });
		}
	});

	it("rejects the wrong old SHA", () => {
		try {
			parseReceivePackCommands(commandPrefix({ oldOid: OLD_OID }), {
				allowedRef: REF,
				newOid: NEW_OID,
				oldOid: ZERO_OID,
			});
			expect.unreachable();
		} catch (error) {
			expect(error).toMatchObject({ code: "old_oid_mismatch" });
		}
	});

	it("rejects a truncated pkt-line", () => {
		const full = encodePktLine(`${ZERO_OID} ${NEW_OID} ${REF}\0 ${CAPS}\n`);
		const truncated = full.subarray(0, 6);
		try {
			parseReceivePackCommands(truncated, {
				allowedRef: REF,
				newOid: NEW_OID,
				oldOid: ZERO_OID,
			});
			expect.unreachable();
		} catch (error) {
			expect(error).toMatchObject({ code: "truncated" });
		}
	});

	it("rejects an overflowing pkt-line length", () => {
		const overflow = concatBytes(
			new Uint8Array([0x66, 0x66, 0x66, 0x66]), // ffff
			new Uint8Array(8),
		);
		expect(() =>
			parseReceivePackCommands(overflow, {
				allowedRef: REF,
				newOid: NEW_OID,
				oldOid: ZERO_OID,
			}),
		).toThrow(/too large|Pkt-line/);
	});

	it("rejects a duplicate command", () => {
		const prefix = concatBytes(
			encodePktLine(`${ZERO_OID} ${NEW_OID} ${REF}\0 ${CAPS}\n`),
			encodePktLine(`${ZERO_OID} ${NEW_OID} ${REF}\n`),
			encodeFlushPkt(),
		);
		try {
			parseReceivePackCommands(prefix, {
				allowedRef: REF,
				newOid: NEW_OID,
				oldOid: ZERO_OID,
			});
			expect.unreachable();
		} catch (error) {
			expect(error).toMatchObject({ code: "duplicate_command" });
		}
	});

	it("rejects push-cert", () => {
		const prefix = concatBytes(
			encodePktLine("push-cert\0 report-status\n"),
			encodeFlushPkt(),
		);
		try {
			parseReceivePackCommands(prefix, {
				allowedRef: REF,
				newOid: NEW_OID,
				oldOid: ZERO_OID,
			});
			expect.unreachable();
		} catch (error) {
			expect(error).toMatchObject({ code: "push_cert" });
		}
	});

	it("rejects push-options", () => {
		try {
			parseReceivePackCommands(
				commandPrefix({ caps: `${CAPS} push-options` }),
				{ allowedRef: REF, newOid: NEW_OID, oldOid: ZERO_OID },
			);
			expect.unreachable();
		} catch (error) {
			expect(error).toMatchObject({ code: "push_options" });
		}
	});

	it("rejects an unknown capability", () => {
		try {
			parseReceivePackCommands(commandPrefix({ caps: `${CAPS} atomic` }), {
				allowedRef: REF,
				newOid: NEW_OID,
				oldOid: ZERO_OID,
			});
			expect.unreachable();
		} catch (error) {
			expect(error).toMatchObject({ code: "capability_denied" });
		}
	});
});

describe("git-receive-pack body split", () => {
	it("splits a command prefix from the pack without accumulating the pack", async () => {
		const prefix = commandPrefix();
		const pack = new Uint8Array(64 * 1024).fill(0x50);
		const body = concatBytes(prefix, pack);
		const split = await splitReceivePackBody(bytesStream(body, 17));
		expect(split.prefix).toEqual(prefix);
		expect(await readAll(split.pack)).toEqual(pack);
	});

	it("rejects an oversized prefix", async () => {
		const huge = new Uint8Array(MAX_RECEIVE_PACK_PREFIX_BYTES + 32).fill(0x61);
		huge.set(encodePktLine("want\n"), 0);
		await expect(
			splitReceivePackBody(bytesStream(huge, 1024)),
		).rejects.toMatchObject({ code: "prefix_too_large" });
	});
});

describe("git-receive-pack report-status", () => {
	it("requires unpack ok and ok for only the expected ref", () => {
		const status = concatBytes(
			encodePktLine("unpack ok\n"),
			encodePktLine(`ok ${REF}\n`),
			encodeFlushPkt(),
		);
		expect(() => parseReportStatus(status, REF)).not.toThrow();
	});

	it("parses a side-band-64k report-status", () => {
		const inner = concatBytes(
			encodePktLine("unpack ok\n"),
			encodePktLine(`ok ${REF}\n`),
			encodeFlushPkt(),
		);
		const framed = new Uint8Array(1 + inner.byteLength);
		framed[0] = 1;
		framed.set(inner, 1);
		const status = concatBytes(encodePktLine(framed), encodeFlushPkt());
		expect(() => parseReportStatus(status, REF)).not.toThrow();
	});

	it("rejects an oversized report-status", () => {
		const huge = new Uint8Array(MAX_REPORT_STATUS_BYTES + 8).fill(0x61);
		expect(() => parseReportStatus(huge, REF)).toThrow(GitReceivePackError);
	});

	it("rejects extra refs in report-status", () => {
		const status = concatBytes(
			encodePktLine("unpack ok\n"),
			encodePktLine(`ok ${REF}\n`),
			encodePktLine("ok refs/heads/other\n"),
			encodeFlushPkt(),
		);
		try {
			parseReportStatus(status, REF);
			expect.unreachable();
		} catch (error) {
			expect(error).toMatchObject({ code: "ref_status_mismatch" });
		}
	});
});
