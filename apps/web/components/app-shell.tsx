import type { ReactNode } from "react";
import { TopNavigation } from "@/components/navigation/top-navigation";
import type { InternalRole } from "@/lib/rbac";

type AppShellProps = {
	children: ReactNode;
	moduleSlug: string;
	user: {
		email?: string;
		name?: string;
		role: InternalRole;
	};
};

export function AppShell({ children, moduleSlug, user }: AppShellProps) {
	const shellClassName = [
		"app-layout",
		moduleSlug === "home" ? "app-layout-home" : "",
		moduleSlug === "dashboard" ? "app-layout-dashboard" : "",
	].filter(Boolean).join(" ");

	return (
		<div className={shellClassName}>
			<TopNavigation user={user} />
			<main className="content-shell" id="main-content" tabIndex={-1}>
				{children}
			</main>
		</div>
	);
}
