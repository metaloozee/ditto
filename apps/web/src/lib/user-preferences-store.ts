import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
	DEFAULT_PROJECT_CODER_MODEL,
	isProjectCoderModelSpecifier,
	type ProjectCoderModelSpecifier,
} from "#/lib/agent-models";

type UserPreferencesState = {
	selectedModel: ProjectCoderModelSpecifier;
	setSelectedModel: (model: ProjectCoderModelSpecifier) => void;
};

export const useUserPreferencesStore = create<UserPreferencesState>()(
	persist(
		(set) => ({
			selectedModel: DEFAULT_PROJECT_CODER_MODEL,
			setSelectedModel: (selectedModel) => set({ selectedModel }),
		}),
		{
			name: "ditto-user-preferences-v1",
			partialize: (state) => ({ selectedModel: state.selectedModel }),
			onRehydrateStorage: () => (state) => {
				if (state && !isProjectCoderModelSpecifier(state.selectedModel)) {
					state.selectedModel = DEFAULT_PROJECT_CODER_MODEL;
				}
			},
		},
	),
);
