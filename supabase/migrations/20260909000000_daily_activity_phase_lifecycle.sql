-- Restore Daily activities as a separate, team-scoped two-phase lifecycle.
-- This migration deliberately keeps the historical daily_task_* tables because
-- their data is Daily activity data, not Project board/task data.

create or replace function public.submit_daily_response_with_activities(
  p_run_ids uuid[],
  p_answers jsonb,
  p_local_date date,
  p_activity_titles text[],
  p_carried_activity_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_team_id uuid;
  v_run_count integer;
  v_team_count integer;
  v_planned_question_id uuid;
  v_planned_question_count integer;
  v_submission_id uuid;
  v_expected_carried_ids uuid[] := array[]::uuid[];
  v_carried_ids uuid[] := coalesce(p_carried_activity_ids, array[]::uuid[]);
  v_activity_titles text[] := coalesce(p_activity_titles, array[]::text[]);
  v_activity_answer text;
  v_schedule record;
  v_local_now timestamp;
  v_carried_count integer;
  v_distinct_carried_count integer;
  v_position integer;
begin
  if v_user_id is null or not private.is_internal_user() then
    raise exception 'An authenticated internal user is required';
  end if;

  if p_run_ids is null or cardinality(p_run_ids) = 0
     or p_local_date is null
     or p_answers is null
     or jsonb_typeof(p_answers) <> 'array' then
    raise exception 'A Daily run, local date, and answer array are required';
  end if;

  if cardinality(v_activity_titles) not between 1 and 100 then
    raise exception 'Daily planned work must contain between 1 and 100 activities';
  end if;
  if exists (
    select 1 from unnest(v_activity_titles) title
    where title is null or char_length(btrim(title)) not between 1 and 400
  ) then
    raise exception 'Every Daily activity must contain 1 to 400 characters';
  end if;

  select count(*), count(distinct r.team_id), min(r.tenant_id::text)::uuid, min(r.team_id::text)::uuid
    into v_run_count, v_team_count, v_tenant_id, v_team_id
  from public.daily_runs r
  where r.id = any(p_run_ids)
    and r.tenant_id = private.current_tenant_id()
    and (
      private.is_tenant_admin(r.tenant_id)
      or private.is_team_member(r.tenant_id, r.team_id)
    );

  if v_run_count <> cardinality(p_run_ids)
     or v_run_count <> (select count(distinct run_id) from unnest(p_run_ids) ids(run_id))
     or v_team_count <> 1 then
    raise exception 'Daily activities must belong to exactly one accessible team';
  end if;

  select count(distinct rq.question_id), min(rq.question_id::text)::uuid
    into v_planned_question_count, v_planned_question_id
  from public.daily_run_questions rq
  left join public.daily_questions q
    on q.tenant_id = rq.tenant_id and q.id = rq.question_id
  where rq.run_id = any(p_run_ids)
    and (rq.semantic_key = 'planned_work' or q.semantic_key = 'planned_work');

  if v_planned_question_count <> 1 then
    raise exception 'The selected Daily runs must have exactly one planned-work question';
  end if;

  v_activity_answer := array_to_string(v_activity_titles, E'\n');
  if char_length(v_activity_answer) not between 1 and 4000 then
    raise exception 'Daily planned work must fit within the response evidence limit';
  end if;

  select s.* into strict v_schedule
  from public.team_daily_schedules s
  join public.teams t
    on t.tenant_id = s.tenant_id and t.id = s.team_id
  where s.tenant_id = v_tenant_id
    and s.team_id = v_team_id
    and s.is_active
    and t.archived_at is null
    and nullif(btrim(s.timezone_name), '') is not null
  for share;

  begin
    v_local_now := clock_timestamp() at time zone v_schedule.timezone_name;
  exception when invalid_parameter_value then
    raise exception 'The Daily team timezone is invalid';
  end;

  if p_local_date <> v_local_now::date or v_local_now::time >= time '16:00' then
    raise exception 'Daily planned work is closed for the team local date';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_tenant_id::text || ':' || v_team_id::text || ':' || p_local_date::text || ':' || v_user_id::text,
      0
    )
  );

  select coalesce(array_agg(item.id order by item.position, item.id), array[]::uuid[])
    into v_expected_carried_ids
  from public.daily_task_items item
  where item.tenant_id = v_tenant_id
    and item.team_id = v_team_id
    and item.user_id = v_user_id
    and item.logical_date = p_local_date
    and item.status = 'planned'
    and item.carried_from_id is not null;

  select count(*), count(distinct carried_id)
    into v_carried_count, v_distinct_carried_count
  from unnest(v_carried_ids) carried(carried_id);

  if v_carried_count <> v_distinct_carried_count
     or v_carried_ids is distinct from v_expected_carried_ids
     or v_carried_count > cardinality(v_activity_titles) then
    raise exception 'Carried Daily activity identifiers are missing, duplicated, or inaccessible';
  end if;

  v_submission_id := public.submit_daily_response(
    p_run_ids,
    p_answers || jsonb_build_array(jsonb_build_object(
      'question_id', v_planned_question_id,
      'answer', v_activity_answer
    )),
    p_local_date
  );

  update public.daily_task_items item
  set title = carried.title
  from (
    select carried.id, planned.title
    from unnest(v_carried_ids) with ordinality carried(id, ordinal)
    join unnest(v_activity_titles) with ordinality planned(title, ordinal)
      using (ordinal)
  ) carried
  where item.tenant_id = v_tenant_id
    and item.team_id = v_team_id
    and item.user_id = v_user_id
    and item.id = carried.id
    and item.status = 'planned';

  select coalesce(max(item.position), 0) + 1
    into v_position
  from public.daily_task_items item
  where item.tenant_id = v_tenant_id
    and item.team_id = v_team_id
    and item.user_id = v_user_id
    and item.logical_date = p_local_date;

  insert into public.daily_task_items (
    tenant_id, team_id, user_id, logical_date, title, position,
    source_submission_id, source_question_id, source_line_ordinal
  )
  select
    v_tenant_id, v_team_id, v_user_id, p_local_date, planned.title,
    v_position + planned.ordinal::integer - v_carried_count - 1,
    v_submission_id, v_planned_question_id, planned.ordinal::integer
  from unnest(v_activity_titles) with ordinality planned(title, ordinal)
  where planned.ordinal > v_carried_count;

  return v_submission_id;
exception
  when no_data_found then
    raise exception 'The Daily team has no active schedule with a valid IANA timezone';
end;
$$;

create or replace function public.submit_daily_activity_completion(
  p_team_id uuid,
  p_logical_date date,
  p_completed_activity_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_local_now timestamp;
  v_schedule record;
  v_completion_id uuid;
  v_next_logical_date date;
  v_next_position integer;
  v_activity_count integer;
  v_completed_count integer;
  v_distinct_completed_count integer;
  v_completed_ids uuid[] := coalesce(p_completed_activity_ids, array[]::uuid[]);
  v_activity record;
  v_outcome text;
  v_next_activity_id uuid;
begin
  if v_user_id is null or not private.is_internal_user() then
    raise exception 'An authenticated internal user is required';
  end if;

  select p.tenant_id into strict v_tenant_id
  from public.profiles p
  where p.id = v_user_id and p.status = 'active';

  if v_tenant_id is distinct from private.current_tenant_id()
     or not (private.is_tenant_admin(v_tenant_id) or private.is_team_member(v_tenant_id, p_team_id)) then
    raise exception 'The selected Daily team is not available to your account';
  end if;

  select s.* into strict v_schedule
  from public.team_daily_schedules s
  join public.teams t
    on t.tenant_id = s.tenant_id and t.id = s.team_id
  where s.tenant_id = v_tenant_id
    and s.team_id = p_team_id
    and s.is_active
    and t.archived_at is null
    and nullif(btrim(s.timezone_name), '') is not null
  for share;

  begin
    v_local_now := clock_timestamp() at time zone v_schedule.timezone_name;
  exception when invalid_parameter_value then
    raise exception 'The Daily team timezone is invalid';
  end;

  if p_logical_date is null or p_logical_date <> v_local_now::date then
    raise exception 'The Daily completion date does not match the team local date';
  end if;
  if v_local_now::time < time '16:00' then
    raise exception 'Daily completion is available after the team local 16:00 cutoff';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_tenant_id::text || ':' || p_team_id::text || ':' || p_logical_date::text || ':' || v_user_id::text,
      0
    )
  );

  if exists (
    select 1 from public.daily_task_completions completion
    where completion.tenant_id = v_tenant_id
      and completion.team_id = p_team_id
      and completion.user_id = v_user_id
      and completion.logical_date = p_logical_date
  ) then
    raise exception 'Daily activity completion is already recorded';
  end if;

  select count(*) into v_completed_count from unnest(v_completed_ids);
  select count(distinct completed_id) into v_distinct_completed_count
  from unnest(v_completed_ids) completed(completed_id);
  if cardinality(v_completed_ids) > 100 then
    raise exception 'Daily completion cannot contain more than 100 activities';
  end if;
  if v_completed_count <> v_distinct_completed_count then
    raise exception 'Daily completed activity identifiers cannot be duplicated';
  end if;

  select count(*) into v_activity_count
  from public.daily_task_items item
  where item.tenant_id = v_tenant_id
    and item.team_id = p_team_id
    and item.user_id = v_user_id
    and item.logical_date = p_logical_date
    and item.status = 'planned';
  if v_activity_count = 0 then
    raise exception 'There are no planned Daily activities to complete';
  end if;

  if exists (
    select 1 from unnest(v_completed_ids) completed(completed_id)
    where not exists (
      select 1 from public.daily_task_items item
      where item.id = completed.completed_id
        and item.tenant_id = v_tenant_id
        and item.team_id = p_team_id
        and item.user_id = v_user_id
        and item.logical_date = p_logical_date
        and item.status = 'planned'
    )
  ) then
    raise exception 'A completed Daily activity is missing or inaccessible';
  end if;

  for v_next_logical_date in
    select (p_logical_date + day_offset)::date
    from generate_series(1, 7) as offsets(day_offset)
    where extract(isodow from p_logical_date + day_offset)::smallint = any(v_schedule.scheduled_weekdays)
    order by day_offset
    limit 1
  loop
    exit;
  end loop;
  if v_next_logical_date is null then
    raise exception 'The Daily team has no next scheduled local date';
  end if;

  insert into public.daily_task_completions (
    tenant_id, team_id, user_id, logical_date, timezone_snapshot
  ) values (
    v_tenant_id, p_team_id, v_user_id, p_logical_date, v_schedule.timezone_name
  ) returning id into v_completion_id;

  select coalesce(max(item.position), 0) + 1 into v_next_position
  from public.daily_task_items item
  where item.tenant_id = v_tenant_id
    and item.team_id = p_team_id
    and item.user_id = v_user_id
    and item.logical_date = v_next_logical_date
    and item.status = 'planned';

  for v_activity in
    select item.id, item.title, item.position
    from public.daily_task_items item
    where item.tenant_id = v_tenant_id
      and item.team_id = p_team_id
      and item.user_id = v_user_id
      and item.logical_date = p_logical_date
      and item.status = 'planned'
    order by item.position, item.id
    for update
  loop
    v_next_activity_id := null;
    if v_activity.id = any(v_completed_ids) then
      v_outcome := 'completed';
      update public.daily_task_items
      set status = 'completed'
      where tenant_id = v_tenant_id and id = v_activity.id;
    else
      v_outcome := 'carried';
      update public.daily_task_items
      set status = 'carried'
      where tenant_id = v_tenant_id and id = v_activity.id;

      insert into public.daily_task_items (
        tenant_id, team_id, user_id, logical_date, title, position, carried_from_id
      ) values (
        v_tenant_id, p_team_id, v_user_id, v_next_logical_date,
        v_activity.title, v_next_position, v_activity.id
      ) returning id into v_next_activity_id;
      v_next_position := v_next_position + 1;
    end if;

    insert into public.daily_task_completion_items (
      tenant_id, completion_id, team_id, user_id, task_id,
      title_snapshot, position, outcome, next_task_id
    ) values (
      v_tenant_id, v_completion_id, p_team_id, v_user_id, v_activity.id,
      v_activity.title, v_activity.position, v_outcome, v_next_activity_id
    );
  end loop;

  return v_completion_id;
exception
  when no_data_found then
    raise exception 'The Daily team has no active schedule with a valid IANA timezone';
end;
$$;

alter function public.submit_daily_response_with_activities(uuid[], jsonb, date, text[], uuid[]) owner to postgres;
alter function public.submit_daily_activity_completion(uuid, date, uuid[]) owner to postgres;
revoke all on function public.submit_daily_response_with_activities(uuid[], jsonb, date, text[], uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.submit_daily_activity_completion(uuid, date, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.submit_daily_response_with_activities(uuid[], jsonb, date, text[], uuid[]) to authenticated;
grant execute on function public.submit_daily_activity_completion(uuid, date, uuid[]) to authenticated;
