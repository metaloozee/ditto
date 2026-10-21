import { expect, it } from "vitest";
import {
	type CandidateCapacity,
	candidateBuilderCapacity,
} from "./candidate-capacity";
import type { BuilderCapacity } from "./project-seed";

it("fits the seed builder capacity port", () => {
	const port: (capacity: CandidateCapacity) => BuilderCapacity =
		candidateBuilderCapacity;
	expect(port).toBeTypeOf("function");
});
