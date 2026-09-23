import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { RolesPermissionsAdmin } from "@/components/admin/roles-permissions-admin";
import { DailyWorkspace } from "@/components/daily/daily-workspace";
import { DashboardPage } from "@/components/dashboard/DashboardPage";
import { WorkspaceModule } from "@/components/workspace-module";
import { getCurrentInternalUser } from "@/lib/auth";
import { getModuleForRole, isAdmin, roleHome } from "@/lib/rbac";

type WorkspacePageProps = {
	params: Promise<{ module: string }>;
	searchParams: Promise<Record<string, string | undefined>>;
};

export default async function WorkspacePage({ params, searchParams }: WorkspacePageProps) {
	const [{ module }, user] = await Promise.all([
		params,
		getCurrentInternalUser(),
	]);

	if (!user) {
		redirect("/login");
	}

	if (!getModuleForRole(user.role, module)) {
		redirect(roleHome[user.role]);
	}

	const isRolesPermissions = module === "roles-permisos" && isAdmin(user.role);
	const isDaily = module === "daily";
	const isDashboard = module === "dashboard";

	return (
		<AppShell moduleSlug={module} user={user}>
			{isRolesPermissions ? (
				<RolesPermissionsAdmin />
			) : isDaily ? (
				<DailyWorkspace role={user.role} />
			) : isDashboard ? (
				<DashboardPage searchParamsPromise={searchParams} user={user} />
			) : (
				<WorkspaceModule moduleSlug={module} role={user.role} />
			)}
		</AppShell>
	);
}
