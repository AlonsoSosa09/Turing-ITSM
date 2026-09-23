-- Enable Supabase Realtime for Jira tables
-- This migration enables realtime publications for live KPI updates

-- Enable realtime for jira_issues (main KPI data source)
alter publication supabase_realtime add table public.jira_issues;

-- Enable realtime for jira_sprints (for burndown/velocity updates)
alter publication supabase_realtime add table public.jira_sprints;

-- Enable realtime for jira_boards (for board-level KPI filtering)
alter publication supabase_realtime add table public.jira_boards;

-- Enable realtime for jira_changelog_entries (for status transition tracking)
alter publication supabase_realtime add table public.jira_changelog_entries;

-- Enable realtime for jira_sync_runs (for sync status updates)
alter publication supabase_realtime add table public.jira_sync_runs;

-- Enable realtime for jira_integrations (for sync status updates)
alter publication supabase_realtime add table public.jira_integrations;

-- Enable realtime for daily_task_items and daily_task_completions (Daily two-phase)
alter publication supabase_realtime add table public.daily_task_items;
alter publication supabase_realtime add table public.daily_task_completions;
alter publication supabase_realtime add table public.daily_task_completion_items;

-- Verify the publication
-- select * from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public';