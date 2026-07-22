import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createDb } from "#/db";
import {
	SessionPreviewError,
	startSessionPreview,
	stopSessionPreview,
} from "#/lib/session-preview";
import { createTRPCRouter, protectedProcedure } from "../init";

function mapSessionPreviewError(error: unknown): never {
	if (error instanceof SessionPreviewError) {
		switch (error.code) {
			case "not_found":
				throw new TRPCError({
					code: "NOT_FOUND",
					message: error.message,
				});
			case "not_ready":
			case "busy":
			case "unsupported_project":
			case "capacity_exhausted":
			case "port_conflict":
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: error.message,
				});
			case "start_failed":
			case "expose_failed":
			case "cleanup_failed":
				throw new TRPCError({
					code: "BAD_GATEWAY",
					message: error.message,
				});
		}
	}
	throw new TRPCError({
		code: "INTERNAL_SERVER_ERROR",
		message: "Preview operation failed.",
	});
}

export const sessionPreviewRouter = createTRPCRouter({
	start: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1).max(128),
				sessionId: z.string().min(1).max(128),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const db = createDb(ctx.env);
			try {
				return await startSessionPreview({
					db,
					env: ctx.env,
					projectId: input.projectId,
					sessionId: input.sessionId,
					userId: ctx.user.id,
					requestUrl: ctx.request.url,
				});
			} catch (error) {
				mapSessionPreviewError(error);
			}
		}),

	stop: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1).max(128),
				sessionId: z.string().min(1).max(128),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const db = createDb(ctx.env);
			try {
				return await stopSessionPreview({
					db,
					env: ctx.env,
					projectId: input.projectId,
					sessionId: input.sessionId,
					userId: ctx.user.id,
					requestUrl: ctx.request.url,
				});
			} catch (error) {
				mapSessionPreviewError(error);
			}
		}),
});
