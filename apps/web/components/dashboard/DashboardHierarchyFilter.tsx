"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";
import type { DashboardHierarchy } from "@/app/actions/dashboard";

type DashboardHierarchyFilterProps = {
  initialTeamId?: string;
  initialProjectId?: string;
  hierarchy: DashboardHierarchy;
};

export function DashboardHierarchyFilter({
  initialTeamId,
  initialProjectId,
  hierarchy,
}: DashboardHierarchyFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const teamId = initialTeamId ?? searchParams.get("teamId") ?? hierarchy.defaultTeamId ?? "";
  const projectId = initialProjectId ?? searchParams.get("projectId") ?? "";
  const projects = useMemo(
    () => [
      { id: "", name: "Todos los proyectos", team_id: "" },
      ...hierarchy.projects
        .filter((project) => !teamId || project.team_id === teamId)
        .map((project) => ({
          id: project.id,
          name: project.name,
          team_id: project.team_id,
        })),
    ],
    [hierarchy.projects, teamId],
  );

  const updateParams = useCallback(
    (patch: Record<string, string>) => {
      startTransition(() => {
        const next = new URLSearchParams(searchParams.toString());
        Object.entries(patch).forEach(([key, value]) => {
          if (value) next.set(key, value);
          else next.delete(key);
        });
        const query = next.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  return (
    <div aria-busy={isPending} className="dashboard-hierarchy-filter">
      <label className="dashboard-filter-field">
        <span>Equipo</span>
        <select
          disabled={isPending}
          onChange={(event) => updateParams({ teamId: event.target.value, projectId: "" })}
          value={teamId}
        >
          <option value="">Todos los equipos</option>
          {hierarchy.teams.map((team) => (
            <option key={team.id} value={team.id}>{team.name}</option>
          ))}
        </select>
      </label>
      <label className="dashboard-filter-field">
        <span>Proyecto</span>
        <select
          disabled={isPending || projects.length <= 1}
          onChange={(event) => updateParams({ projectId: event.target.value })}
          value={projects.some((project) => project.id === projectId) ? projectId : ""}
        >
          {projects.map((project) => (
            <option key={project.id || "all"} value={project.id}>{project.name}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
