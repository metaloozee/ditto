// Usage: node cdp.mjs <url> <expression>
// Opens <url> in the browser over DevTools and prints, as JSON, what <expression>
// resolves to in that page. Only DevTools traffic stays on 127.0.0.1; the page's own
// traffic leaves through the browser's proxy, the filter.
const [url, expression] = process.argv.slice(2);
const devtools = "http://127.0.0.1:9222";

const target = await (await fetch(`${devtools}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let nextId = 0;
const pending = new Map();
const events = new Set();
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id === undefined) return events.forEach((listener) => listener(message));
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    pending.set(++nextId, { resolve, reject });
    ws.send(JSON.stringify({ id: nextId, method, params }));
  });

await send("Page.enable");
const loaded = new Promise((resolve) =>
  events.add((message) => message.method === "Page.loadEventFired" && resolve()),
);
const { errorText } = await send("Page.navigate", { url });
if (errorText) throw new Error(`navigation to ${url} failed: ${errorText}`);
await loaded;

const { result, exceptionDetails } = await send("Runtime.evaluate", {
  expression,
  awaitPromise: true,
  returnByValue: true,
});
if (exceptionDetails) {
  throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
}
console.log(JSON.stringify(result.value));

ws.close();
await fetch(`${devtools}/json/close/${target.id}`);
