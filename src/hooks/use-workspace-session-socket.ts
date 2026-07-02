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
	liveRunId: string | null;
	lastDoneRunId: string | null;
	needsInput: LiveNeedsInput | null;
};

const initialState: WorkspaceSessionSocketState = {
	connected: false,
	assistantText: "",
	liveRunId: null,
	lastDoneRunId: null,
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
							assistantText:
								current.liveRunId === frame.runId
									? `${current.assistantText}${frame.text}`
									: frame.text,
							liveRunId: frame.runId,
							lastDoneRunId: null,
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
						return {
							...current,
							liveRunId: frame.runId,
							lastDoneRunId: frame.runId,
							needsInput: null,
						};
					case "snapshot":
						if (frame.state.activeRunId) {
							return frame.state.activeRunId === current.liveRunId
								? current
								: {
										...current,
										assistantText: "",
										liveRunId: frame.state.activeRunId,
										lastDoneRunId: null,
									};
						}

						return current.lastDoneRunId
							? current
							: {
									...current,
									assistantText: "",
									liveRunId: null,
									needsInput: null,
								};
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
