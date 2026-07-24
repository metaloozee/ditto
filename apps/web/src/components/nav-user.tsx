import { Link } from "@tanstack/react-router";
import {
	ChevronsUpDownIcon,
	LogInIcon,
	LogOutIcon,
	SettingsIcon,
} from "lucide-react";
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
										Account Settings
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
						<DropdownMenuGroup>
							<DropdownMenuItem
								render={<Link to="/settings" aria-label="Settings" />}
							>
								<SettingsIcon />
								Settings
							</DropdownMenuItem>
						</DropdownMenuGroup>
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
