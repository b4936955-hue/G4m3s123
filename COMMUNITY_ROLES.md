# Community Role Notes

Roles are enforced in Supabase, not trusted from browser code.

## Role powers
- `owner`: can manage roles and role grants, publish posts, edit/delete any post.
- `admin`: can publish posts and edit/delete any post.
- `mod`: can publish posts and edit/delete only their own posts.
- `member`: can read posts and copy post text.
- `banned`: reserved for blocking later.

## Make yourself owner
Run this in Supabase SQL Editor after your account exists:

```sql
update public.profiles
set role = 'owner'
where lower(username) = lower('YOUR_USERNAME');
```

## Hardcode future users to roles
This applies when that username creates/signs into an account for the first time. If a higher role manually changes the profile later, that manual role stays.

```sql
insert into public.role_grants (username, role, note)
values
  ('friendname', 'mod', 'trusted poster'),
  ('adminname', 'admin', 'can manage posts')
on conflict (username) do update
set role = excluded.role,
    note = excluded.note;
```

## Change an existing user's role
Only owners should do this:

```sql
update public.profiles
set role = 'admin'
where lower(username) = lower('THE_USERNAME');
```

Allowed role values: `owner`, `admin`, `mod`, `member`, `banned`.