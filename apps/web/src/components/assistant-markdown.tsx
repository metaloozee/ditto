import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";
import { Streamdown } from "streamdown";
import { cn } from "#/lib/utils";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("go", go);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

const LANGUAGE_ALIASES: Record<string, string> = {
	cjs: "javascript",
	htm: "xml",
	html: "xml",
	js: "javascript",
	jsx: "javascript",
	md: "markdown",
	mjs: "javascript",
	py: "python",
	rs: "rust",
	sh: "bash",
	shell: "bash",
	ts: "typescript",
	tsx: "typescript",
	yml: "yaml",
	zsh: "bash",
};

const LANGUAGE_RE = /language-([^\s]+)/;

type CodeProps = ComponentProps<"code"> & {
	node?: unknown;
	"data-block"?: string;
};

type TableProps = ComponentProps<"table"> & { node?: unknown };
type TheadProps = ComponentProps<"thead"> & { node?: unknown };
type ThProps = ComponentProps<"th"> & { node?: unknown };
type TdProps = ComponentProps<"td"> & { node?: unknown };

function childrenToText(children: ReactNode): string {
	if (typeof children === "string" || typeof children === "number") {
		return String(children);
	}
	if (Array.isArray(children)) {
		return children.map(childrenToText).join("");
	}
	if (
		isValidElement(children) &&
		children.props &&
		typeof children.props === "object" &&
		"children" in children.props
	) {
		return childrenToText(
			(children.props as { children?: ReactNode }).children,
		);
	}
	return "";
}

function resolveLanguage(className?: string): string | undefined {
	const match = className?.match(LANGUAGE_RE);
	const raw = match?.[1]?.toLowerCase();
	if (!raw) {
		return undefined;
	}
	return LANGUAGE_ALIASES[raw] ?? raw;
}

function highlightCode(code: string, language?: string): string | null {
	if (!language || !hljs.getLanguage(language)) {
		return null;
	}
	try {
		return hljs.highlight(code, { language, ignoreIllegals: true }).value;
	} catch {
		return null;
	}
}

function MarkdownCode({
	className,
	children,
	node: _node,
	...props
}: CodeProps) {
	const isBlock = "data-block" in props;
	const code = childrenToText(children).replace(/\n$/, "");
	const language = resolveLanguage(className);
	const highlighted = isBlock ? highlightCode(code, language) : null;

	if (!isBlock) {
		return (
			<code
				className={cn(
					"rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]",
					className,
				)}
			>
				{children}
			</code>
		);
	}

	return (
		<pre className="my-3 overflow-x-auto rounded-lg border border-border bg-card p-3 text-[0.85em] leading-relaxed">
			{highlighted ? (
				<code
					className={cn("hljs font-mono", language && `language-${language}`)}
					// highlight.js escapes source text; only token spans are injected
					// biome-ignore lint/security/noDangerouslySetInnerHtml: hljs-escaped highlight markup
					dangerouslySetInnerHTML={{ __html: highlighted }}
				/>
			) : (
				<code className={cn("font-mono", className)}>{code}</code>
			)}
		</pre>
	);
}

function MarkdownTable({
	children,
	className,
	node: _node,
	...props
}: TableProps) {
	return (
		<div className="my-4 w-full overflow-x-auto">
			<table
				className={cn("w-full border-collapse text-sm", className)}
				{...props}
			>
				{children}
			</table>
		</div>
	);
}

function MarkdownThead({
	children,
	className,
	node: _node,
	...props
}: TheadProps) {
	return (
		<thead
			className={cn("border-border border-b bg-muted/50", className)}
			{...props}
		>
			{children}
		</thead>
	);
}

function MarkdownTh({ children, className, node: _node, ...props }: ThProps) {
	return (
		<th
			className={cn(
				"px-3 py-2 text-left font-medium text-foreground",
				className,
			)}
			{...props}
		>
			{children}
		</th>
	);
}

function MarkdownTd({ children, className, node: _node, ...props }: TdProps) {
	return (
		<td
			className={cn(
				"border-border border-t px-3 py-2 text-foreground/90",
				className,
			)}
			{...props}
		>
			{children}
		</td>
	);
}

const markdownComponents = {
	code: MarkdownCode,
	table: MarkdownTable,
	thead: MarkdownThead,
	th: MarkdownTh,
	td: MarkdownTd,
};

export function AssistantMarkdown({
	mode,
	text,
}: {
	mode: "static" | "streaming";
	text: string;
}) {
	return (
		<Streamdown
			className="prose prose-sm max-w-none text-sm/relaxed dark:prose-invert prose-pre:my-3 prose-pre:bg-card prose-code:text-[0.85em]"
			components={markdownComponents}
			controls={{ table: false, code: false, mermaid: false }}
			lineNumbers={false}
			mode={mode}
			parseIncompleteMarkdown={mode === "streaming"}
		>
			{text}
		</Streamdown>
	);
}
