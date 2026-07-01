import { useEffect, useState } from "react";
import type { WorkspaceSessionBrokerFrame } from "#/lib/workspace-session-broker";

type LiveNeedsInput = {
	runId: string;
	question: string;
	requestId: string;
};

export type WorkspaceSessionSocketState = {
	connected: boolean;
	assistantText: string;
	needsInput: LiveNeedsInput | null;
};

const initialState: WorkspaceSessionSocketState = {
	connected: false,
	assistantText: "",
	needsInput: null,
};

function parseFrame(value: string): WorkspaceSessionBrokerFrame | null {
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === "object"
			? (parsed as WorkspaceSessionBrokerFrame)
			: null;
	} catch {
		return null;
	}
}

export function useWorkspaceSessionSocket(
	sessionId: string | null | undefined,
): WorkspaceSessionSocketState {
	const [state, setState] = useState<WorkspaceSessionSocketState>(initialState);

	useEffect(() => {
		if (!sessionId || typeof window === "undefined") {
			setState(initialState);
			return;
		}

		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const socket = new WebSocket(
			`${protocol}//${window.location.host}/api/workspace/session/${encodeURIComponent(
				sessionId,
			)}/socket`,
		);

		socket.addEventListener("open", () => {
			setState((current) => ({ ...current, connected: true }));
		});

		socket.addEventListener("message", (event) => {
			if (typeof event.data !== "string") {
				return;
			}

			const frame = parseFrame(event.data);
			if (!frame) {
				return;
			}

			setState((current) => {
				switch (frame.type) {
					case "assistant_delta":
						return {
							...current,
							assistantText: `${current.assistantText}${frame.text}`,
						};
					case "needs_input":
						return {
							...current,
							needsInput: {
								runId: frame.runId,
								question: frame.question,
								requestId: frame.requestId,
							},
						};
					case "done":
						return { ...current, assistantText: "", needsInput: null };
					case "snapshot":
						return frame.state.activeRunId
							? current
							: { ...current, assistantText: "", needsInput: null };
					default:
						return current;
				}
			});
		});

		const markDisconnected = () => {
			setState((current) => ({ ...current, connected: false }));
		};
		socket.addEventListener("close", markDisconnected);
		socket.addEventListener("error", markDisconnected);

		return () => {
			socket.close();
		};
	}, [sessionId]);

	return state;
}
