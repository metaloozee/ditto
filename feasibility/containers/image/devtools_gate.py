"""The only way to Chrome's DevTools (#37, ADR-0007), run as the `devtools` user.

Chrome listens on 127.0.0.1:9222, and the entrypoint's fence lets only this user connect there.
This gate relays port 9223, which the Worker reaches, to it. Take-over locks the gate: every
relayed session is closed and new ones are refused until hand-back unlocks it.

POST /lock    close every session, refuse new ones  -> {"locked": true, "closed": n}
POST /unlock  accept sessions again                 -> {"locked": false}
GET  /        the current state

The lock port (8082) is fenced from every local process, so no bot on the computer can unlock it.
"""

import asyncio
import json

CHROME = ("127.0.0.1", 9222)
state = {"locked": False}
sessions: set[asyncio.StreamWriter] = set()


async def pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while data := await reader.read(65536):
            writer.write(data)
            await writer.drain()
    except (ConnectionError, OSError):
        pass
    finally:
        writer.close()


async def relay(client_reader: asyncio.StreamReader, client: asyncio.StreamWriter) -> None:
    try:
        chrome_reader, chrome = await asyncio.open_connection(*CHROME)
    except OSError:
        client.close()
        return
    # Checked after the connect, with no await before registering, so a /lock that ran while
    # this connection was opening still stops it.
    if state["locked"]:
        chrome.close()
        client.close()
        return
    sessions.update((client, chrome))
    try:
        await asyncio.gather(pipe(client_reader, chrome), pipe(chrome_reader, client))
    finally:
        sessions.difference_update((client, chrome))


async def control(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    request = (await reader.readline()).decode(errors="replace").split()
    while (await reader.readline()) not in (b"\r\n", b"\n", b""):
        pass
    method, path = (request + ["", ""])[:2]
    status, body = 200, {}
    if method == "POST" and path == "/lock":
        state["locked"] = True
        closed = len(sessions) // 2
        for session in list(sessions):
            session.close()
        body = {"locked": True, "closed": closed}
    elif method == "POST" and path == "/unlock":
        state["locked"] = False
        body = {"locked": False}
    elif method == "GET" and path == "/":
        body = {"locked": state["locked"], "sessions": len(sessions) // 2}
    else:
        status, body = 404, {"error": "not found"}
    data = json.dumps(body).encode()
    writer.write(
        f"HTTP/1.1 {status} {'OK' if status == 200 else 'Not Found'}\r\n"
        f"content-type: application/json\r\ncontent-length: {len(data)}\r\n"
        "connection: close\r\n\r\n".encode()
        + data
    )
    await writer.drain()
    writer.close()


async def main() -> None:
    gate = await asyncio.start_server(relay, "0.0.0.0", 9223)
    lock = await asyncio.start_server(control, "0.0.0.0", 8082)
    async with gate, lock:
        await asyncio.gather(gate.serve_forever(), lock.serve_forever())


asyncio.run(main())
