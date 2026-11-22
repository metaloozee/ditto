// In-page probes for the WebSocket and HTTP/2 checks, shared by the local trial (#28) and the
// Cloudflare Containers trial (#32) so both measure the same thing.

export type WebSocketSession = {
	opened: boolean;
	greeting: string | null;
	sent: number;
	echoed: number;
	openForMs: number;
	openAtEnd: boolean;
	closeCode: number | null;
};

export const WEBSOCKET_PAGE = "https://echo.websocket.org/";

/** Holds wss://echo.websocket.org/ open for `holdMs`, pinging every 2s; resolves a WebSocketSession. */
export const websocketProbe = (holdMs: number) => `new Promise((resolve) => {
	const ws = new WebSocket("wss://echo.websocket.org/");
	const s = { opened: false, greeting: null, sent: 0, echoed: 0, openForMs: 0, openAtEnd: false, closeCode: null };
	let start = 0, timer;
	const send = () => { ws.send("ping " + s.sent); s.sent++; };
	ws.onmessage = ({ data }) => {
		if (String(data).startsWith("ping ")) s.echoed++;
		else s.greeting ??= String(data).slice(0, 40);
	};
	ws.onclose = (e) => { s.closeCode = e.code; clearInterval(timer); s.openForMs = Date.now() - start; resolve(s); };
	ws.onopen = () => {
		s.opened = true;
		start = Date.now();
		send();
		timer = setInterval(send, 2000);
		setTimeout(() => {
			clearInterval(timer);
			s.openForMs = Date.now() - start;
			s.openAtEnd = ws.readyState === WebSocket.OPEN;
			// Let the last echo arrive, then hang up.
			setTimeout(() => { resolve({ ...s }); ws.close(); }, 2000);
		}, ${holdMs});
	};
})`;

export const HTTP2_PAGE = "https://example.com/";

/** The protocol the page's navigation used, `h2` when HTTP/2 reached the filter. */
export const http2Probe = `performance.getEntriesByType("navigation")[0].nextHopProtocol`;
