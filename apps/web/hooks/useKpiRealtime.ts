"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

type RealtimePayload<T extends Record<string, unknown>> =
  RealtimePostgresChangesPayload<T>;

interface UseKpiRealtimeOptions<T extends Record<string, unknown>> {
  /** Tables to subscribe to (e.g., ['jira_issues', 'jira_sprints']) */
  tables: string[];
  /** Filter by tenant (automatically added) */
  tenantId?: string;
  /** Callback when a realtime event occurs */
  onEvent: (payload: RealtimePayload<T>) => void;
  /** Whether the subscription is active */
  enabled?: boolean;
}

/**
 * Hook for subscribing to Supabase Realtime updates for KPI data.
 *
 * Usage:
 * ```tsx
 * useKpiRealtime({
 *   tables: ['jira_issues', 'jira_sprints', 'jira_boards'],
 *   tenantId: context.tenantId,
 *   onEvent: (payload) => {
 *     if (payload.eventType === 'INSERT') {
 *       // Handle new issue/sprint/board
 *     }
 *     // Invalidate queries or update local state
 *     queryClient.invalidateQueries({ queryKey: ['kpi'] });
 *   },
 *   enabled: true,
 * });
 * ```
 */
export function useKpiRealtime<T extends Record<string, unknown> = Record<string, unknown>>({
  tables,
  tenantId,
  onEvent,
  enabled = true,
}: UseKpiRealtimeOptions<T>) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const channelRef = useRef<
    ReturnType<ReturnType<typeof createClient>["channel"]> | null
  >(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const handleRealtimeEvent = useCallback(
    (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
      // Add tenant filtering if provided
      if (tenantId && payload.new && typeof payload.new === "object") {
        const record = payload.new as Record<string, unknown>;
        if (record.tenant_id && record.tenant_id !== tenantId) {
          return; // Skip events from other tenants
        }
      }
      onEvent(payload as RealtimePayload<T>);
    },
    [tenantId, onEvent]
  );

  // Memoize tables string for dependency
  const tablesKey = tables.join(",");

  useEffect(() => {
    if (!enabled || tables.length === 0) {
      return;
    }

    const supabase = supabaseRef.current ?? (supabaseRef.current = createClient());

    // Create a unique channel name using memoized tablesKey
    const channelName = `kpi-realtime-${tablesKey.replace(/,/g, "-")}-${tenantId || "global"}`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: tables[0],
          filter: tenantId ? `tenant_id=eq.${tenantId}` : undefined,
        },
        handleRealtimeEvent
      );

    // Subscribe to additional tables
    for (let i = 1; i < tables.length; i++) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: tables[i],
          filter: tenantId ? `tenant_id=eq.${tenantId}` : undefined,
        },
        handleRealtimeEvent
      );
    }

    channelRef.current = channel;

    // Subscribe with connection status handling
    channel
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setIsConnected(true);
          setError(null);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setIsConnected(false);
          setError(new Error(`Realtime connection failed: ${status}`));
        } else if (status === "CLOSED") {
          setIsConnected(false);
        }
      });

    // Cleanup on unmount or dependency change
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
        setIsConnected(false);
      }
    };
  }, [enabled, tables, tablesKey, tenantId, handleRealtimeEvent]);

  return {
    isConnected,
    error,
    /** Manually reconnect (useful after auth changes) */
    reconnect: () => {
      if (channelRef.current) {
        channelRef.current.subscribe();
      }
    },
  };
}

/**
 * Convenience hook for KPI dashboard realtime updates.
 * Subscribes to all KPI-relevant tables.
 */
export function useKpiDashboardRealtime(
  tenantId: string | undefined,
  onUpdate: () => void,
  enabled: boolean = true
) {
  return useKpiRealtime({
    tables: [
      "jira_issues",
      "jira_sprints",
      "jira_boards",
      "jira_changelog_entries",
      "jira_sync_runs",
      "jira_integrations",
    ],
    tenantId,
    onEvent: () => {
      // Trigger a refetch or state update
      onUpdate();
    },
    enabled,
  });
}

/**
 * Hook for sync status realtime updates.
 */
export function useSyncStatusRealtime(
  integrationId: string | undefined,
  onStatusChange: (status: string) => void,
  enabled: boolean = true
) {
  return useKpiRealtime({
    tables: ["jira_sync_runs", "jira_integrations"],
    tenantId: undefined, // Will filter by integration_id in onEvent
    onEvent: (payload) => {
      if (payload.new && typeof payload.new === "object") {
        const record = payload.new as Record<string, unknown>;
        if (integrationId && record.jira_integration_id === integrationId) {
          const status = record.status as string;
          onStatusChange(status);
        }
      }
    },
    enabled,
  });
}
