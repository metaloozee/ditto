export class AssistantStreamDraft {
	private runId: string | null = null;
	private text = "";

	append(runId: string, delta: string): void {
		if (!delta) {
			return;
		}

		if (this.runId !== runId) {
			this.runId = runId;
			this.text = "";
		}

		this.text += delta;
	}

	consume(runId: string): string | null {
		if (this.runId !== runId) {
			return null;
		}

		const text = this.text.trim();
		this.clear();

		return text ? text : null;
	}

	clear(runId?: string): void {
		if (runId && this.runId !== runId) {
			return;
		}

		this.runId = null;
		this.text = "";
	}
}
