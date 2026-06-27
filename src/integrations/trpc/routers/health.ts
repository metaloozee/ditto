import { createTRPCRouter, protectedProcedure, publicProcedure } from "../init";

export const healthRouter = createTRPCRouter({
	public: publicProcedure.query(() => ({
		ok: true,
		visibility: "public",
	})),
	protected: protectedProcedure.query(({ ctx }) => ({
		ok: true,
		visibility: "protected",
		userId: ctx.user.id,
	})),
});
