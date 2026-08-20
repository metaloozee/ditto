import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
	clampToSupportedThinkingLevel,
	DEFAULT_THINKING_LEVEL,
	FALLBACK_MODEL_THINKING_LEVELS,
	isPiThinkingLevel,
	isSupportedThinkingLevel,
	type PiThinkingLevel,
	type SupportedThinkingLevel,
} from "#/lib/agent-models";

type UserPreferencesState = {
	/** Saved abstract preference; not overwritten when a model only supports off. */
	thinkingLevel: SupportedThinkingLevel;
	setThinkingLevel: (level: PiThinkingLevel) => void;
};

function clampPersistedThinkingLevel(value: unknown): SupportedThinkingLevel {
	if (!isPiThinkingLevel(value)) return DEFAULT_THINKING_LEVEL;
	return clampToSupportedThinkingLevel(
		value,
		FALLBACK_MODEL_THINKING_LEVELS,
	) as SupportedThinkingLevel;
}

export const useUserPreferencesStore = create<UserPreferencesState>()(
	persist(
		(set) => ({
			thinkingLevel: DEFAULT_THINKING_LEVEL,
			setThinkingLevel: (thinkingLevel) => {
				if (!isSupportedThinkingLevel(thinkingLevel)) return;
				set({ thinkingLevel });
			},
		}),
		{
			name: "ditto-user-preferences-v1",
			partialize: (state) => ({
				thinkingLevel: state.thinkingLevel,
			}),
			merge: (persisted, current) => {
				const stored =
					persisted && typeof persisted === "object"
						? (persisted as Record<string, unknown>)
						: {};
				return {
					...current,
					thinkingLevel: clampPersistedThinkingLevel(stored.thinkingLevel),
				};
			},
			onRehydrateStorage: () => (state) => {
				if (!state) return;
				state.thinkingLevel = clampPersistedThinkingLevel(state.thinkingLevel);
			},
		},
	),
);
