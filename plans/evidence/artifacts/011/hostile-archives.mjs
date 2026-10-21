// Writes hostile tar.gz fixtures that GNU tar would sanitize on creation.
// Usage: node hostile-archives.mjs <out-dir>
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

function member(name, type, body = "", linkName = "") {
	const header = Buffer.alloc(512);
	const field = (value, offset, length) => header.write(value, offset, length, "utf8");
	const octal = (value, offset, length) =>
		field(`${value.toString(8).padStart(length - 1, "0")}\0`, offset, length);
	field(name, 0, 100);
	octal(0o644, 100, 8);
	octal(0, 108, 8);
	octal(0, 116, 8);
	octal(Buffer.byteLength(body), 124, 12);
	octal(1_700_000_000, 136, 12);
	field("        ", 148, 8);
	field(type, 156, 1);
	field(linkName, 157, 100);
	field("ustar\0", 257, 6);
	field("00", 263, 2);
	let sum = 0;
	for (const byte of header) sum += byte;
	field(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
	const data = Buffer.alloc(Math.ceil(Buffer.byteLength(body) / 512) * 512);
	data.write(body);
	return Buffer.concat([header, data]);
}

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const cases = {
	traversal: [member("../escape.txt", "0", "x")],
	absolute: [member("/tmp/escape.txt", "0", "x")],
	"symlink-escape": [member("evil", "2", "", "/etc"), member("evil/escape.txt", "0", "x")],
	"ambiguous-symlink": [member("evil", "2", "", "/etc -> safe")],
	"hardlink-escape": [member("hard", "1", "", "/etc/passwd")],
	device: [member("dev", "3")],
};
for (const [name, members] of Object.entries(cases))
	fs.writeFileSync(
		path.join(out, `${name}.tar.gz`),
		gzipSync(Buffer.concat([...members, Buffer.alloc(1024)])),
	);
