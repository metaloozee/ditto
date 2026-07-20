import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
	DEFAULT_PROJECT_CODER_MODEL,
	DEFAULT_THINKING_LEVEL,
	isPiThinkingLevel,
	MAX_MODEL_SPECIFIER_LENGTH,
	type PiThinkingLevel,
	parseModelSpecifier,
} from "#/lib/agent-models";

type UserPreferencesState = {
	selectedModel: string;
	setSelectedModel: (model: string) => void;
	/** Saved abstract preference; not overwritten when a model only supports off. */
	thinkingLevel: PiThinkingLevel;
	setThinkingLevel: (level: PiThinkingLevel) => void;
};

function isBoundedModelPreference(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= MAX_MODEL_SPECIFIER_LENGTH &&
		parseModelSpecifier(value) !== null
	);
}

export const useUserPreferencesStore = create<UserPreferencesState>()(
	persist(
		(set) => ({
			selectedModel: DEFAULT_PROJECT_CODER_MODEL,
			setSelectedModel: (selectedModel) => {
				if (!isBoundedModelPreference(selectedModel)) return;
				set({ selectedModel });
			},
			thinkingLevel: DEFAULT_THINKING_LEVEL,
			setThinkingLevel: (thinkingLevel) => {
				if (!isPiThinkingLevel(thinkingLevel)) return;
				set({ thinkingLevel });
			},
		}),
		{
			name: "ditto-user-preferences-v1",
			partialize: (state) => ({
				selectedModel: state.selectedModel,
				thinkingLevel: state.thinkingLevel,
			}),
			onRehydrateStorage: () => (state) => {
				if (!state) return;
				if (!isBoundedModelPreference(state.selectedModel)) {
					state.selectedModel = DEFAULT_PROJECT_CODER_MODEL;
				}
				if (!isPiThinkingLevel(state.thinkingLevel)) {
					state.thinkingLevel = DEFAULT_THINKING_LEVEL;
				}
			},
		},
	),
);
