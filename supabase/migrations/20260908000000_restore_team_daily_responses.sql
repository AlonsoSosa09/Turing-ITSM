create or replace function public.submit_daily_response_with_tasks(
  p_run_ids uuid[],
  p_answers jsonb,
  p_local_date date,
  p_carried_task_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_team_count integer;
begin
  if v_user_id is null or not private.is_internal_user() then
    raise exception 'An authenticated internal user is required';
  end if;

  if coalesce(cardinality(p_carried_task_ids), 0) <> 0 then
    raise exception 'Daily task compatibility arguments must be empty';
  end if;

  select count(distinct r.team_id)
    into v_team_count
  from public.daily_runs r
  where r.id = any(p_run_ids)
    and r.tenant_id = private.current_tenant_id()
    and (
      private.is_tenant_admin(r.tenant_id)
      or private.is_team_member(r.tenant_id, r.team_id)
    );

  if v_team_count <> 1 then
    raise exception 'Daily responses must belong to exactly one team';
  end if;

  return public.submit_daily_response(p_run_ids, p_answers, p_local_date);
end;
$$;

alter function public.submit_daily_response_with_tasks(uuid[], jsonb, date, uuid[]) owner to postgres;
revoke all on function public.submit_daily_response_with_tasks(uuid[], jsonb, date, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.submit_daily_response_with_tasks(uuid[], jsonb, date, uuid[]) to authenticated;
revoke execute on function public.submit_daily_response(uuid[], jsonb, date) from authenticated;
revoke all on function public.add_daily_task_items(uuid, date, text[]) from public, anon, authenticated, service_role;
revoke all on function public.submit_daily_task_completion(uuid, date, uuid[], text) from public, anon, authenticated, service_role;
