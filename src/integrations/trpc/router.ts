import type { TRPCRouterRecord } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "./init";

const healthRouter = {
	public: publicProcedure.query(() => ({
		ok: true,
		visibility: "public" as const,
	})),
	protected: protectedProcedure.query(({ ctx }) => ({
		ok: true,
		visibility: "protected" as const,
		userId: ctx.user.id,
	})),
} satisfies TRPCRouterRecord;

export const trpcRouter = createTRPCRouter({
	health: healthRouter,
});
export type TRPCRouter = typeof trpcRouter;
