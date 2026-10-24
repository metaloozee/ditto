import { Link } from "@tanstack/react-router";
import { ChevronsUpDownIcon, LogInIcon, LogOutIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSkeleton,
	useSidebar,
} from "#/components/ui/sidebar";
import { authClient } from "#/lib/auth.client";
import {
	CODEX_CONNECTION_VIEWS,
	useCodexConnection,
} from "#/lib/candidate-session-client";

function CodexConnectionMenu() {
	const codex = useCodexConnection();
	const view = CODEX_CONNECTION_VIEWS[codex.status];

	return (
		<DropdownMenuGroup>
			<div className="flex items-center justify-between gap-3 px-1.5 py-1 text-sm">
				<span className="font-medium">Codex</span>
				<span className="min-w-0 text-pretty text-right text-xs text-muted-foreground">
					{codex.isPending ? null : view.label}
				</span>
			</div>
			{view.action && !codex.isPending ? (
				<DropdownMenuItem
					role="button"
					disabled={codex.actionPending}
					closeOnClick={false}
					onClick={() => {
						if (view.action) codex.runAction(view.action);
					}}
				>
					{view.verb}
				</DropdownMenuItem>
			) : null}
		</DropdownMenuGroup>
	);
}

function getInitials(name?: string | null, email?: string | null) {
	const source = name || email || "User";
	return source
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase())
		.join("");
}

function HiddenEmail({ email }: { email: string }) {
	return (
		<span className="inline-flex min-h-4 max-w-full items-center overflow-hidden">
			<span className="sr-only">Email address hidden until hover or focus</span>
			<span
				className="max-w-full select-none truncate opacity-70 blur-[3px] transition-[filter,opacity] duration-150 ease-out group-hover/user:opacity-100 group-hover/user:blur-none group-focus-within/user:opacity-100 group-focus-within/user:blur-none"
				aria-hidden="true"
			>
				{email}
			</span>
		</span>
	);
}

export function NavUser() {
	const { isMobile } = useSidebar();
	const { data: session, isPending } = authClient.useSession();

	if (isPending) {
		return (
			<SidebarMenu>
				<SidebarMenuItem>
					<SidebarMenuSkeleton showIcon />
				</SidebarMenuItem>
			</SidebarMenu>
		);
	}

	if (!session?.user) {
		return (
			<SidebarMenu>
				<SidebarMenuItem>
					<SidebarMenuButton
						size="lg"
						className="group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!"
						tooltip="Sign in"
						render={
							<Link to="/sign-in">
								<LogInIcon />
								<span className="group-data-[collapsible=icon]:hidden">
									Sign in
								</span>
							</Link>
						}
					/>
				</SidebarMenuItem>
			</SidebarMenu>
		);
	}

	const user = session.user;
	const displayName = user.name || "Signed in";
	const email = user.email;
	const initials = getInitials(user.name, user.email);

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<SidebarMenuButton
								size="lg"
								className="group/user data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
							>
								<Avatar className="size-8 rounded-lg">
									<AvatarImage src={user.image ?? undefined} alt="" />
									<AvatarFallback className="rounded-lg">
										{initials}
									</AvatarFallback>
								</Avatar>
								<div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
									<span className="truncate font-medium">{displayName}</span>
									<span className="min-h-4 truncate text-xs text-sidebar-foreground/70">
										<HiddenEmail email={email} />
									</span>
								</div>
								<ChevronsUpDownIcon className="ml-auto" />
							</SidebarMenuButton>
						}
					/>
					<DropdownMenuContent
						className="min-w-56"
						side={isMobile ? "bottom" : "right"}
						align="end"
						sideOffset={4}
					>
						<DropdownMenuGroup>
							<DropdownMenuItem className="group/user flex items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm">
								<Avatar className="size-8 rounded-lg">
									<AvatarImage src={user.image ?? undefined} alt="" />
									<AvatarFallback className="rounded-lg">
										{initials}
									</AvatarFallback>
								</Avatar>
								<div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
									<span className="truncate font-medium">{displayName}</span>
									<span className="min-h-4 truncate text-xs text-muted-foreground">
										<HiddenEmail email={email} />
									</span>
								</div>
							</DropdownMenuItem>
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
						<CodexConnectionMenu />
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuItem
								role="button"
								onClick={() => {
									void authClient.signOut();
									window.location.reload();
								}}
								variant="destructive"
							>
								<LogOutIcon />
								Log out
							</DropdownMenuItem>
						</DropdownMenuGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
