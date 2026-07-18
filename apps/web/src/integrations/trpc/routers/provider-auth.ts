import { z } from "zod";
import { createDb } from "#/db";
import { createTRPCRouter, protectedProcedure } from "#/integrations/trpc/init";
import {
	createCredentialRepository,
	deleteCredentialWithLease,
	listConnections,
} from "#/lib/account-provider-credentials";
import {
	getProviderCatalog,
	listAccountModels,
} from "#/lib/provider-auth-service";

export const providerAuthRouter = createTRPCRouter({
	catalog: protectedProcedure.query(async ({ ctx }) => {
		return getProviderCatalog({ env: ctx.env });
	}),

	connections: protectedProcedure.query(async ({ ctx }) => {
		const db = createCredentialRepository(createDb(ctx.env));
		const connections = await listConnections(db, ctx.session.user.id);
		return {
			connections: connections.map((c) => ({
				providerId: c.providerId,
				authType: c.authType,
				status: c.status,
				lastErrorCode: c.lastErrorCode,
				models: c.models,
			})),
		};
	}),

	models: protectedProcedure.query(async ({ ctx }) => {
		const db = createCredentialRepository(createDb(ctx.env));
		const models = await listAccountModels({
			db,
			userId: ctx.session.user.id,
			listConnections,
		});
		return {
			models: models.map((m) => ({
				id: `${m.providerId}/${m.modelId}`,
				name: m.name,
				provider: m.providerId,
				providerName: m.providerId,
				cost: m.cost,
				input: m.input,
				reasoning: m.reasoning,
				contextWindow: m.contextWindow,
				maxTokens: m.maxTokens,
			})),
		};
	}),

	disconnect: protectedProcedure
		.input(z.object({ providerId: z.string().min(1).max(64) }).strict())
		.mutation(async ({ ctx, input }) => {
			const db = createCredentialRepository(createDb(ctx.env));
			const ok = await deleteCredentialWithLease({
				db,
				userId: ctx.session.user.id,
				providerId: input.providerId,
			});
			return { deleted: ok };
		}),
});
