"use client";

import { useQuery } from "@tanstack/react-query";
import { ClientOnly, useNavigate } from "@tanstack/react-router";
import { FileTextIcon, PlusIcon } from "lucide-react";
import type { JSX } from "react";
import { useEffect, useState } from "react";
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
	CommandShortcut,
} from "#/components/ui/command";
import { useTRPC } from "#/integrations/trpc/react";
import { authClient } from "#/lib/auth.client";

export function CommandMenu(): JSX.Element {
	return (
		<ClientOnly fallback={null}>
			<CommandMenuClient />
		</ClientOnly>
	);
}

function CommandMenuClient(): JSX.Element {
	const [open, setOpen] = useState(false);
	const navigate = useNavigate();
	const trpc = useTRPC();
	const { data: session } = authClient.useSession();
	const projectsQuery = useQuery(
		trpc.projects.list.queryOptions(undefined, {
			enabled: Boolean(session),
		}),
	);
	const projects = projectsQuery.data ?? [];

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				(event.key === "k" || event.key === "K") &&
				(event.metaKey || event.ctrlKey) &&
				!event.altKey
			) {
				event.preventDefault();
				setOpen((current) => !current);
			}
		};
		const onOpenRequest = () => setOpen(true);

		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("ditto:open-command-menu", onOpenRequest);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("ditto:open-command-menu", onOpenRequest);
		};
	}, []);

	return (
		<CommandDialog
			open={open}
			onOpenChange={setOpen}
			title="Command menu"
			description="Search projects and jump to common actions."
			className="sm:max-w-xl"
		>
			<Command>
				<CommandInput placeholder="Search projects..." />
				<CommandList>
					<CommandEmpty>No projects found.</CommandEmpty>
					<CommandGroup heading="Projects">
						{projects.map((project, index) => (
							<CommandItem
								key={project.id}
								value={`${project.name} ${project.description ?? ""}`}
								onSelect={() => {
									setOpen(false);
									void navigate({
										to: "/project/$projectId",
										params: { projectId: project.id },
									});
								}}
								className="cursor-pointer py-2"
							>
								<div className="flex min-w-0 flex-1 flex-col">
									<span className="truncate text-sm font-medium">
										{project.name}
									</span>
									{project.description ? (
										<span className="truncate text-muted-foreground">
											{project.description}
										</span>
									) : null}
								</div>
								<CommandShortcut>P{index + 1}</CommandShortcut>
							</CommandItem>
						))}
					</CommandGroup>
					<CommandSeparator />
					<CommandGroup heading="Quick actions">
						<CommandItem
							value="Go to home"
							onSelect={() => {
								setOpen(false);
								void navigate({ to: "/" });
							}}
							className="cursor-pointer py-2"
						>
							<PlusIcon aria-hidden="true" />
							<span className="text-sm font-medium">Go to home</span>
						</CommandItem>
						<CommandItem
							value="Open settings"
							onSelect={() => {
								setOpen(false);
								void navigate({ to: "/settings" });
							}}
							className="cursor-pointer py-2"
						>
							<FileTextIcon aria-hidden="true" />
							<span className="text-sm font-medium">Open settings</span>
						</CommandItem>
					</CommandGroup>
				</CommandList>
			</Command>
		</CommandDialog>
	);
}
