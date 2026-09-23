export const RUNTIME_LIMITS = {
	commandBodyBytes: 64 * 1024,
	commandTextCharacters: 32_000,
	idBytes: 128,
	deliveryEnvelopeBytes: 8 * 1024,
	brainControlRecordBytes: 1024 * 1024,
	streamFrameBytes: 64 * 1024,
	subscriberBufferBytes: 1024 * 1024,
	jsonMaxNesting: 64,
} as const;
