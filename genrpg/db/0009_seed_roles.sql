-- Created: 2026-05-17
-- Seed the default GenRPG permissions

INSERT INTO genrpg.permissions (name, description) VALUES
  ('instance.edit', 'Edit instance name, description, and packages'),
  ('instance.delete', 'Delete an instance'),
  ('instance.run', 'Run/enter an instance'),
  ('instance.manage_packages', 'Manage packages assigned to an instance'),
  ('instance.manage_users', 'Manage user role assignments on an instance')
ON CONFLICT (name) DO NOTHING;

-- Seed the default GenRPG roles

INSERT INTO genrpg.roles (name, description) VALUES
  ('Instance_Owner', 'Full control over the instance including user management'),
  ('Instance_GM', 'Game Master with most permissions except managing owners'),
  ('Instance_Player', 'Can run/enter the instance')
ON CONFLICT (name) DO NOTHING;

-- Assign permissions to roles

-- Instance_Owner gets all permissions
INSERT INTO genrpg.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM genrpg.roles r
CROSS JOIN genrpg.permissions p
WHERE r.name = 'Instance_Owner'
  AND p.name IN ('instance.edit', 'instance.delete', 'instance.run', 'instance.manage_packages', 'instance.manage_users')
ON CONFLICT DO NOTHING;

-- Instance_GM gets all permissions
INSERT INTO genrpg.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM genrpg.roles r
CROSS JOIN genrpg.permissions p
WHERE r.name = 'Instance_GM'
  AND p.name IN ('instance.edit', 'instance.delete', 'instance.run', 'instance.manage_packages', 'instance.manage_users')
ON CONFLICT DO NOTHING;

-- Instance_Player gets only run permission
INSERT INTO genrpg.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM genrpg.roles r
CROSS JOIN genrpg.permissions p
WHERE r.name = 'Instance_Player'
  AND p.name IN ('instance.run')
ON CONFLICT DO NOTHING;
