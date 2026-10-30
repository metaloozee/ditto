import type { PiDurableExecutionSession } from "../../runtime/src/pi-durable-execution-session.ts";
import type { CandidatePrivateProduct as CandidatePrivateProductPort } from "../../runtime/src/pi-durable-product-session.ts";
import type {
	CandidatePrivateProduct,
	CandidateSessionRpc,
} from "../../web/src/lib/candidate-product";

type AssertTrue<T extends true> = T;

export type ProductConforms = AssertTrue<
	CandidatePrivateProduct extends CandidatePrivateProductPort ? true : never
>;
export type SessionConforms = AssertTrue<
	PiDurableExecutionSession extends CandidateSessionRpc ? true : never
>;
