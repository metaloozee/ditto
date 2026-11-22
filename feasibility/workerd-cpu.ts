// CPU time of the local workerd process behind an `alchemy dev` port, read from Linux /proc.
// Inside a Worker the clock stands still while code runs, so CPU can only be measured from outside.
import { readdir, readFile, readlink } from "node:fs/promises";

async function listeningInodes(port: number): Promise<Set<string>> {
	const hex = port.toString(16).toUpperCase().padStart(4, "0");
	const inodes = new Set<string>();
	for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
		const text = await readFile(table, "utf8").catch(() => "");
		for (const line of text.split("\n").slice(1)) {
			const cols = line.trim().split(/\s+/);
			// cols[1] is local address:port, cols[3] state (0A = LISTEN), cols[9] inode.
			if (cols[1]?.endsWith(`:${hex}`) && cols[3] === "0A" && cols[9]) inodes.add(cols[9]);
		}
	}
	return inodes;
}

async function pids(): Promise<number[]> {
	return (await readdir("/proc")).filter((name) => /^\d+$/.test(name)).map(Number);
}

async function stat(pid: number) {
	const text = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");
	const close = text.lastIndexOf(")");
	const comm = text.slice(text.indexOf("(") + 1, close);
	const ppid = Number(text.slice(close + 2).split(" ")[1]);
	return { comm, ppid };
}

/**
 * The workerd processes started by whichever process listens on `port`: `alchemy dev`
 * proxies the port from Node and runs workerd as its child.
 */
export async function findWorkerd(port: number): Promise<number[]> {
	const inodes = await listeningInodes(port);
	const all = await pids();
	const listeners = new Set<number>();
	for (const pid of all) {
		const fds = await readdir(`/proc/${pid}/fd`).catch(() => []);
		for (const fd of fds) {
			const link = await readlink(`/proc/${pid}/fd/${fd}`).catch(() => "");
			const inode = /^socket:\[(\d+)\]$/.exec(link)?.[1];
			if (inode && inodes.has(inode)) listeners.add(pid);
		}
	}
	const found: number[] = [];
	for (const pid of all) {
		const { comm, ppid } = await stat(pid);
		if (comm === "workerd" && (listeners.has(ppid) || listeners.has(pid))) found.push(pid);
	}
	return found;
}

/** Total on-CPU time of every thread of the processes, in milliseconds (schedstat is in ns). */
export async function cpuMs(processes: number[]): Promise<number> {
	let ns = 0;
	for (const pid of processes) {
		for (const task of await readdir(`/proc/${pid}/task`).catch(() => [])) {
			const text = await readFile(`/proc/${pid}/task/${task}/schedstat`, "utf8").catch(() => "0");
			ns += Number(text.split(" ")[0]);
		}
	}
	return ns / 1e6;
}
