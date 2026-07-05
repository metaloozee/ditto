import { PatchDiff } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangleIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Spinner } from "#/components/ui/spinner";
import { useTRPC } from "#/integrations/trpc/react";

type DiffReviewProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projectId: string;
	runId: string;
	artifactId?: number;
};

export function DiffReview({
	open,
	onOpenChange,
	projectId,
	runId,
	artifactId,
}: DiffReviewProps) {
	const trpc = useTRPC();
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		setMounted(true);
	}, []);

	const query = useQuery(
		trpc.workspace.getRunDiff.queryOptions(
			{ projectId, runId, artifactId },
			{ enabled: open && mounted, retry: false },
		),
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				showCloseButton
				className="w-full gap-0 p-0 sm:max-w-4xl max-h-[80dvh]"
			>
				<DialogHeader className="px-4 pt-4 pb-2">
					<DialogTitle>Run diff review</DialogTitle>
					<DialogDescription>
						Review the patch produced by this run.
					</DialogDescription>
				</DialogHeader>
				<div className="max-h-[60dvh] overflow-auto border-t border-border/30 p-2">
					{!mounted || query.isPending ? (
						<div className="flex items-center gap-2 p-6 text-muted-foreground text-xs">
							<Spinner size="sm" />
							<span>Loading diff...</span>
						</div>
					) : query.error ? (
						<div className="flex items-center gap-2 p-6 text-destructive text-xs">
							<AlertTriangleIcon className="size-4" />
							<span>Diff unavailable.</span>
						</div>
					) : (
						<PatchDiff
							patch={query.data.patch}
							disableWorkerPool
							options={{
								diffStyle: "split",
								overflow: "wrap",
								diffIndicators: "bars",
								lineDiffType: "word-alt",
								stickyHeader: true,
							}}
						/>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
