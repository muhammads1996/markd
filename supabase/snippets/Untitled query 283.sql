do $$
declare
  operator_id uuid := '90000000-0000-4000-8000-000000000001';
begin
  insert into auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_token,
    recovery_token,
    email_change,
    email_change_token_current,
    email_change_token_new,
    reauthentication_token,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values (
    operator_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'operator@example.test',
    crypt('Markd-Local-2026!', gen_salt('bf')),
    now(),
    '',
    '',
    '',
    '',
    '',
    '',
    '{}',
    '{}',
    now(),
    now()
  )
  on conflict (id) do update set
    email = excluded.email,
    encrypted_password = excluded.encrypted_password,
    email_confirmed_at = now(),
    updated_at = now();

  insert into public.operator_accounts (user_id, role)
  values (operator_id, 'ops_admin')
  on conflict (user_id) do update set
    role = 'ops_admin',
    archived_at = null;
end
$$;