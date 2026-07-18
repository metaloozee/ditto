import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
	DEFAULT_PROJECT_CODER_MODEL,
	MAX_MODEL_SPECIFIER_LENGTH,
	parseModelSpecifier,
} from "#/lib/agent-models";

type UserPreferencesState = {
	selectedModel: string;
	setSelectedModel: (model: string) => void;
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
		}),
		{
			name: "ditto-user-preferences-v1",
			partialize: (state) => ({ selectedModel: state.selectedModel }),
			onRehydrateStorage: () => (state) => {
				if (state && !isBoundedModelPreference(state.selectedModel)) {
					state.selectedModel = DEFAULT_PROJECT_CODER_MODEL;
				}
			},
		},
	),
);
