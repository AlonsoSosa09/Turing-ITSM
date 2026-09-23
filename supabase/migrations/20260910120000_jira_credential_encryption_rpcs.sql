-- Jira Integration: Credential Encryption RPCs
-- Provides pgp_sym_encrypt/decrypt for jira_integration credentials
-- and a secure decryption RPC for authorized sync operations.

-- Ensure pgcrypto is available (already in 20260902023428 migration)
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Encryption key management
-- -----------------------------------------------------------------------------
-- The encryption key is stored as a database configuration parameter.
-- In production, this should be set via ALTER SYSTEM or in postgresql.conf.
-- For development, we use a configurable default.

-- Encryption key parameter name
-- Set via: ALTER SYSTEM SET jira.encryption_key = 'your-base64-encoded-key';
-- Then: SELECT pg_reload_conf();

-- -----------------------------------------------------------------------------
-- Helper: get encryption key from config
-- -----------------------------------------------------------------------------
create or replace function private.jira_encryption_key()
returns text
language sql
security definer
set search_path = ''
as $$
    select current_setting('jira.encryption_key', true);
$$;

-- -----------------------------------------------------------------------------
-- Encrypt a plaintext credential using pgp_sym_encrypt
-- -----------------------------------------------------------------------------
create or replace function public.encrypt_jira_credential(
    p_plaintext text
)
returns bytea
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_key text;
    v_ciphertext bytea;
begin
    -- Get encryption key from config
    v_key := private.jira_encryption_key();

    if v_key is null or v_key = '' then
        raise exception 'Jira encryption key not configured. Set jira.encryption_key parameter.';
    end if;

    -- Encrypt using pgp_sym_encrypt
    -- pgp_sym_encrypt(data text, psw text, options text) returns bytea
    -- options: 'compress-algo=1' for zlib compression
    v_ciphertext := pgp_sym_encrypt(p_plaintext, v_key, 'compress-algo=1');

    return v_ciphertext;
exception
    when others then
        raise exception 'Failed to encrypt credential: %', sqlerrm;
end;
$$;

-- -----------------------------------------------------------------------------
-- Decrypt a credential using pgp_sym_decrypt
-- -----------------------------------------------------------------------------
create or replace function public.decrypt_jira_credential(
    p_ciphertext bytea
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_key text;
    v_plaintext text;
begin
    -- Get encryption key from config
    v_key := private.jira_encryption_key();

    if v_key is null or v_key = '' then
        raise exception 'Jira encryption key not configured. Set jira.encryption_key parameter.';
    end if;

    -- Decrypt using pgp_sym_decrypt
    -- pgp_sym_decrypt(msg bytea, psw text, options text) returns text
    v_plaintext := pgp_sym_decrypt(p_ciphertext, v_key, 'compress-algo=1');

    return v_plaintext;
exception
    when others then
        raise exception 'Failed to decrypt credential: %', sqlerrm;
end;
$$;

-- -----------------------------------------------------------------------------
-- Get decrypted Jira integration (admin/sync only)
-- Returns integration with decrypted credentials for authorized sync operations
-- -----------------------------------------------------------------------------
create or replace function public.get_decrypted_jira_integration(
    p_integration_id uuid,
    p_tenant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_record record;
    v_email text;
    v_token text;
    v_result jsonb;
begin
    -- Verify caller is authenticated internal user
    if auth.uid() is null or not private.is_internal_user() then
        raise exception 'An authenticated internal user is required';
    end if;

    -- Verify tenant access (tenant admin or service role)
    if p_tenant_id is distinct from private.current_tenant_id() then
        raise exception 'Tenant access denied';
    end if;

    -- Verify caller is tenant admin (for credential access)
    if not private.is_tenant_admin(p_tenant_id) then
        raise exception 'Tenant admin access required to decrypt credentials';
    end if;

    -- Fetch the integration record
    select *
    into v_record
    from public.jira_integrations
    where id = p_integration_id
      and tenant_id = p_tenant_id;

    if not found then
        raise exception 'Integration not found';
    end if;

    -- Decrypt credentials
    v_email := public.decrypt_jira_credential(v_record.jira_email_encrypted);
    v_token := public.decrypt_jira_credential(v_record.jira_api_token_encrypted);

    -- Build result with decrypted credentials
    v_result := jsonb_build_object(
        'id', v_record.id,
        'tenant_id', v_record.tenant_id,
        'jira_domain', v_record.jira_domain,
        'jira_email', v_email,
        'jira_api_token', v_token,
        'default_board_id', v_record.default_board_id,
        'story_points_field', v_record.story_points_field,
        'created_by', v_record.created_by,
        'created_at', v_record.created_at,
        'updated_at', v_record.updated_at,
        'last_synced_at', v_record.last_synced_at,
        'sync_status', v_record.sync_status
    );

    return v_result;
exception
    when others then
        raise exception 'Failed to get decrypted integration: %', sqlerrm;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
alter function public.encrypt_jira_credential(text) owner to postgres;
alter function public.decrypt_jira_credential(bytea) owner to postgres;
alter function public.get_decrypted_jira_integration(uuid, uuid) owner to postgres;

revoke all on function public.encrypt_jira_credential(text) from public, anon, authenticated, service_role;
revoke all on function public.decrypt_jira_credential(bytea) from public, anon, authenticated, service_role;
revoke all on function public.get_decrypted_jira_integration(uuid, uuid) from public, anon, authenticated, service_role;

grant execute on function public.encrypt_jira_credential(text) to authenticated;
grant execute on function public.decrypt_jira_credential(bytea) to authenticated;
-- get_decrypted_jira_integration is restricted to tenant admins via internal check
grant execute on function public.get_decrypted_jira_integration(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Comments
-- -----------------------------------------------------------------------------
comment on function public.encrypt_jira_credential(text) is
'Encrypt a plaintext Jira credential using pgp_sym_encrypt with the configured encryption key.';

comment on function public.decrypt_jira_credential(bytea) is
'Decrypt a Jira credential ciphertext using pgp_sym_decrypt with the configured encryption key.';

comment on function public.get_decrypted_jira_integration(uuid, uuid) is
'Get a Jira integration with decrypted credentials. Requires tenant admin access. Used by sync service for authenticated API calls.';