import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs/react";
import { MultiFileDiff, PatchDiff } from "@pierre/diffs/react";
import { ClientOnly } from "@tanstack/react-router";
import { ChevronRightIcon, LoaderCircleIcon } from "lucide-react";
import { useState } from "react";
import type { StreamToolCall } from "#/lib/agent-message-parts";
import {
	type EditToolDiffData,
	formatToolCallLabel,
	getEditToolDiffData,
} from "#/lib/agent-tool-presentation";
import { cn } from "#/lib/utils";

/**
 * Pierre's split + overflow:scroll uses `overflow-y: clip` on code panes, so
 * vertical scrolling must live on a wrapper around the host. Wrap long lines so
 * each affected line stays fully readable in the narrow chat column.
 *
 * `options.collapsed` is a first-class library feature: body hidden, header kept.
 * Interactive collapse is not built-in — docs require wiring a custom header.
 */
const BASE_DIFF_OPTIONS = {
	themeType: "dark" as const,
	diffStyle: "split" as const,
	overflow: "wrap" as const,
	diffIndicators: "bars" as const,
	lineDiffType: "word-alt" as const,
	stickyHeader: true,
	expandUnchanged: true,
	hunkSeparators: "line-info-basic" as const,
	unsafeCSS: `
		:host {
			display: block;
			width: 100%;
			min-width: 0;
		}
		[data-diff],
		[data-file] {
			width: 100%;
			min-width: 0;
		}
		[data-line] {
			min-height: 1lh;
		}
		/* Make room for our custom collapse header */
		[data-diffs-header="custom"] {
			width: 100%;
		}
	`,
};

function normalizeFileContents(contents: string): string {
	const normalized = contents.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (normalized.length === 0) {
		return "";
	}
	return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function isUsablePatch(patch: string | null | undefined): patch is string {
	if (!patch || patch.length < 8) {
		return false;
	}
	if (patch.endsWith("…") || patch.includes("[truncated")) {
		return false;
	}
	try {
		const parsed = parsePatchFiles(patch, undefined, true);
		return parsed.some((entry) => entry.files.length > 0);
	} catch {
		return false;
	}
}

function countDiffStats(fileDiff: FileDiffMetadata): {
	additions: number;
	deletions: number;
} {
	let additions = 0;
	let deletions = 0;
	for (const hunk of fileDiff.hunks) {
		additions += hunk.additionCount;
		deletions += hunk.deletionCount;
	}
	return { additions, deletions };
}

function CollapseHeader({
	fileDiff,
	collapsed,
	onToggle,
}: {
	fileDiff: FileDiffMetadata;
	collapsed: boolean;
	onToggle: () => void;
}) {
	const { additions, deletions } = countDiffStats(fileDiff);
	const name = fileDiff.name || "file";

	return (
		<button
			type="button"
			aria-expanded={!collapsed}
			onClick={onToggle}
			className="flex w-full cursor-pointer items-center gap-2 border-border border-b bg-muted/40 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/70"
		>
			<ChevronRightIcon
				className={cn(
					"size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
					!collapsed && "rotate-90",
				)}
			/>
			<span
				className="min-w-0 flex-1 truncate font-medium text-foreground"
				title={name}
				dir="rtl"
			>
				<span dir="ltr">{name}</span>
			</span>
			<span className="flex shrink-0 items-center gap-2 font-mono tabular-nums">
				{additions > 0 ? (
					<span className="text-emerald-500">+{additions}</span>
				) : null}
				{deletions > 0 ? (
					<span className="text-red-400">-{deletions}</span>
				) : null}
			</span>
		</button>
	);
}

/** Collapsed shell shown while the edit tool is still running. */
function EditToolRunningHeader({ name }: { name: string }) {
	return (
		<div
			className="flex w-full items-center gap-2 border-border bg-muted/40 px-3 py-2 text-left text-xs"
			aria-busy="true"
		>
			<ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
			<span
				className="min-w-0 flex-1 truncate font-medium text-foreground"
				title={name}
				dir="rtl"
			>
				<span dir="ltr">{name}</span>
			</span>
			<LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
		</div>
	);
}

function DiffBody({ data }: { data: EditToolDiffData }) {
	const [collapsed, setCollapsed] = useState(false);
	const onToggle = () => {
		setCollapsed((value) => !value);
	};

	const oldContents = normalizeFileContents(data.oldContents);
	const newContents = normalizeFileContents(data.newContents);

	const oldFile = {
		name: data.path,
		contents: oldContents,
		cacheKey: `old:${data.path}:${oldContents}`,
	};
	const newFile = {
		name: data.path,
		contents: newContents,
		cacheKey: `new:${data.path}:${newContents}`,
	};

	const options = {
		...BASE_DIFF_OPTIONS,
		collapsed,
	};

	const renderCustomHeader = (fileDiff: FileDiffMetadata) => (
		<CollapseHeader
			fileDiff={fileDiff}
			collapsed={collapsed}
			onToggle={onToggle}
		/>
	);

	const usablePatch = isUsablePatch(data.patch) ? data.patch : null;
	const canUseFiles = oldContents.length > 0 || newContents.length > 0;

	if (!canUseFiles && usablePatch) {
		return (
			<PatchDiff
				patch={usablePatch}
				options={options}
				renderCustomHeader={renderCustomHeader}
				disableWorkerPool
				className="block w-full min-w-0"
			/>
		);
	}

	if (!canUseFiles) {
		return null;
	}

	return (
		<MultiFileDiff
			oldFile={oldFile}
			newFile={newFile}
			options={options}
			renderCustomHeader={renderCustomHeader}
			disableWorkerPool
			className="block w-full min-w-0"
		/>
	);
}

function EditToolFallback({ tool }: { tool: StreamToolCall }) {
	const label = formatToolCallLabel(tool);
	const failed = tool.status === "error";

	return (
		<div
			className={cn(
				"flex items-center gap-2 rounded-md border px-3 py-2 font-mono text-[12px]",
				failed
					? "border-destructive/40 text-destructive"
					: "border-border text-muted-foreground",
			)}
		>
			<span className="min-w-0 truncate" title={label}>
				{label}
			</span>
		</div>
	);
}

function editToolDisplayName(
	tool: StreamToolCall,
	data: EditToolDiffData | null,
): string {
	if (data?.path) {
		return data.path;
	}
	const label = formatToolCallLabel(tool);
	return label === "edit" ? "file" : label.replace(/^edit\s+/, "");
}

export function EditToolPart({ tool }: { tool: StreamToolCall }) {
	const data = getEditToolDiffData(tool);
	const failed = tool.status === "error";
	const running = tool.status === "running";
	const name = editToolDisplayName(tool, data);

	if (running) {
		return (
			<div className="w-full min-w-0 overflow-hidden rounded-md border bg-card">
				<EditToolRunningHeader name={name} />
			</div>
		);
	}

	if (!data || (data.oldContents.length === 0 && !data.patch)) {
		return <EditToolFallback tool={tool} />;
	}

	return (
		<div
			className={cn(
				"w-full min-w-0 overflow-hidden rounded-md border bg-card",
				failed && "border-destructive/50",
			)}
		>
			{/* Vertical scroll lives here: pierre code panes clip overflow-y. */}
			<div className="max-h-96 w-full min-w-0 overflow-x-auto overflow-y-auto overscroll-contain">
				<ClientOnly fallback={<EditToolRunningHeader name={name} />}>
					<DiffBody data={data} />
				</ClientOnly>
			</div>
		</div>
	);
}
