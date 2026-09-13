-- Rename the User Management permission key: the expand/migrate step of
-- docs/specs/security-hardening-and-user-management.md (rollout phase 2).
-- Hand-written; no schema change.
--
-- Copy each role's exact `access` level to `userManagement`. A role without a
-- valid level gets `none`, never CRUD. The legacy key stays until the contract
-- step so the previous release can still read it.
UPDATE "roles"
SET "perms" = "perms" || jsonb_build_object(
  'userManagement',
  CASE WHEN "perms"->>'access' IN ('none', 'read', 'crud') THEN "perms"->>'access' ELSE 'none' END
)
WHERE NOT ("perms" ? 'userManagement');--> statement-breakpoint
-- Keep the legacy key readable by the previous release during the overlap.
UPDATE "roles"
SET "perms" = "perms" || jsonb_build_object('access', "perms"->>'userManagement')
WHERE NOT ("perms" ? 'access');--> statement-breakpoint
-- Today, CRUD on this permission at any hotel is global User Management
-- authority. Record that as explicit platform authority so the later scoped
-- model starts from exactly who holds it now. A group grants only through the
-- hotels attached to it, matching the application's RBAC.
UPDATE "users" SET "platform_admin" = true
WHERE NOT "platform_admin" AND "id" IN (
  SELECT a."user_id" FROM "assignments" a
  JOIN "roles" r ON r."id" = a."role_id"
  WHERE r."perms"->>'userManagement' = 'crud'
  UNION
  SELECT gm."user_id" FROM "group_members" gm
  JOIN "groups" g ON g."id" = gm."group_id"
  JOIN "group_hotels" gh ON gh."group_id" = g."id"
  JOIN "roles" r ON r."id" = g."role_id"
  WHERE r."perms"->>'userManagement' = 'crud'
);--> statement-breakpoint
-- Guard: when any Active account holds that authority, at least one Active
-- Platform Administrator must exist afterwards, or the whole migration rolls back.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "users" u
    WHERE u."status" = 'active' AND (
      EXISTS (
        SELECT 1 FROM "assignments" a JOIN "roles" r ON r."id" = a."role_id"
        WHERE a."user_id" = u."id" AND r."perms"->>'userManagement' = 'crud'
      ) OR EXISTS (
        SELECT 1 FROM "group_members" gm
        JOIN "group_hotels" gh ON gh."group_id" = gm."group_id"
        JOIN "groups" g ON g."id" = gm."group_id"
        JOIN "roles" r ON r."id" = g."role_id"
        WHERE gm."user_id" = u."id" AND r."perms"->>'userManagement' = 'crud'
      )
    )
  ) AND NOT EXISTS (SELECT 1 FROM "users" WHERE "platform_admin" AND "status" = 'active') THEN
    RAISE EXCEPTION 'User Management permission migration would leave no Active Platform Administrator';
  END IF;
END
$$;
