import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { createAuth } from "#/lib/auth";

export async function createTRPCContext({
	request,
	env,
}: {
	request: Request;
	env: Env;
}) {
	const auth = createAuth(env);
	const session = await auth.api.getSession({
		headers: request.headers,
	});

	return {
		request,
		env,
		auth,
		session,
	};
}

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<TRPCContext>().create({
	transformer: superjson,
});

const enforceUserIsAuthed = t.middleware(({ ctx, next }) => {
	if (!ctx.session?.user) {
		throw new TRPCError({ code: "UNAUTHORIZED" });
	}

	return next({
		ctx: {
			...ctx,
			session: ctx.session,
			user: ctx.session.user,
		},
	});
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(enforceUserIsAuthed);
