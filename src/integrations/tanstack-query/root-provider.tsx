import type { ReactNode } from "react";
import {
	type getContext,
	trpcClient,
} from "#/integrations/tanstack-query/root-context";
import { TRPCProvider } from "#/integrations/trpc/react";

export default function TanstackQueryProvider({
	children,
	context,
}: {
	children: ReactNode;
	context: ReturnType<typeof getContext>;
}) {
	const { queryClient } = context;

	return (
		<TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
			{children}
		</TRPCProvider>
	);
}
