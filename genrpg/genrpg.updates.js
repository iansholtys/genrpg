module.exports = {
  1: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS packages (
        package text PRIMARY KEY,
        version integer NOT NULL DEFAULT 0
      );
    `);
    await client.query(`
      ALTER TABLE instances
        ADD COLUMN IF NOT EXISTS packages text NOT NULL DEFAULT 'genrpg';
    `);
  },

  2: async (client) => {
    // Add create_datetime/update_datetime to session table
    await client.query(`
      ALTER TABLE genrpg.session
        ADD COLUMN IF NOT EXISTS create_datetime timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS update_datetime timestamptz NOT NULL DEFAULT now();
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS session_update_datetime ON genrpg.session;
      CREATE TRIGGER session_update_datetime
        BEFORE UPDATE ON genrpg.session
        FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
    `);

    // Add create_datetime/update_datetime to packages table
    await client.query(`
      ALTER TABLE genrpg.packages
        ADD COLUMN IF NOT EXISTS create_datetime timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS update_datetime timestamptz NOT NULL DEFAULT now();
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS packages_update_datetime ON genrpg.packages;
      CREATE TRIGGER packages_update_datetime
        BEFORE UPDATE ON genrpg.packages
        FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
    `);

    // Create roles table
    await client.query(`
      CREATE TABLE IF NOT EXISTS genrpg.roles (
        id serial PRIMARY KEY,
        name text NOT NULL UNIQUE,
        description text NOT NULL DEFAULT '',
        create_datetime timestamptz NOT NULL DEFAULT now(),
        update_datetime timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS roles_update_datetime ON genrpg.roles;
      CREATE TRIGGER roles_update_datetime
        BEFORE UPDATE ON genrpg.roles
        FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
    `);

    // Create permissions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS genrpg.permissions (
        id serial PRIMARY KEY,
        name text NOT NULL UNIQUE,
        description text NOT NULL DEFAULT '',
        create_datetime timestamptz NOT NULL DEFAULT now(),
        update_datetime timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS permissions_update_datetime ON genrpg.permissions;
      CREATE TRIGGER permissions_update_datetime
        BEFORE UPDATE ON genrpg.permissions
        FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
    `);

    // Create role_permissions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS genrpg.role_permissions (
        role_id integer NOT NULL REFERENCES genrpg.roles(id) ON DELETE CASCADE,
        permission_id integer NOT NULL REFERENCES genrpg.permissions(id) ON DELETE CASCADE,
        create_datetime timestamptz NOT NULL DEFAULT now(),
        update_datetime timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (role_id, permission_id)
      );
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS role_permissions_update_datetime ON genrpg.role_permissions;
      CREATE TRIGGER role_permissions_update_datetime
        BEFORE UPDATE ON genrpg.role_permissions
        FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
    `);

    // Seed permissions
    await client.query(`
      INSERT INTO genrpg.permissions (name, description) VALUES
        ('instance.edit', 'Edit instance name, description, and packages'),
        ('instance.delete', 'Delete an instance'),
        ('instance.run', 'Run/enter an instance'),
        ('instance.manage_packages', 'Manage packages assigned to an instance'),
        ('instance.manage_users', 'Manage user role assignments on an instance')
      ON CONFLICT (name) DO NOTHING;
    `);

    // Seed roles
    await client.query(`
      INSERT INTO genrpg.roles (name, description) VALUES
        ('Instance_Owner', 'Full control over the instance including user management'),
        ('Instance_GM', 'Game Master with most permissions except managing owners'),
        ('Instance_Player', 'Can run/enter the instance')
      ON CONFLICT (name) DO NOTHING;
    `);

    // Assign permissions to roles
    await client.query(`
      INSERT INTO genrpg.role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM genrpg.roles r CROSS JOIN genrpg.permissions p
      WHERE r.name = 'Instance_Owner'
        AND p.name IN ('instance.edit', 'instance.delete', 'instance.run', 'instance.manage_packages', 'instance.manage_users')
      ON CONFLICT DO NOTHING;
    `);
    await client.query(`
      INSERT INTO genrpg.role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM genrpg.roles r CROSS JOIN genrpg.permissions p
      WHERE r.name = 'Instance_GM'
        AND p.name IN ('instance.edit', 'instance.delete', 'instance.run', 'instance.manage_packages', 'instance.manage_users')
      ON CONFLICT DO NOTHING;
    `);
    await client.query(`
      INSERT INTO genrpg.role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM genrpg.roles r CROSS JOIN genrpg.permissions p
      WHERE r.name = 'Instance_Player'
        AND p.name IN ('instance.run')
      ON CONFLICT DO NOTHING;
    `);

    // Create instance_user_roles table
    await client.query(`
      CREATE TABLE IF NOT EXISTS genrpg.instance_user_roles (
        instance_guid uuid NOT NULL REFERENCES genrpg.instances(guid) ON DELETE CASCADE,
        user_guid uuid NOT NULL REFERENCES genrpg.users(guid) ON DELETE CASCADE,
        role_id integer NOT NULL REFERENCES genrpg.roles(id) ON DELETE CASCADE,
        create_datetime timestamptz NOT NULL DEFAULT now(),
        update_datetime timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (instance_guid, user_guid)
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_instance_user_roles_user
        ON genrpg.instance_user_roles(user_guid);
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS instance_user_roles_update_datetime ON genrpg.instance_user_roles;
      CREATE TRIGGER instance_user_roles_update_datetime
        BEFORE UPDATE ON genrpg.instance_user_roles
        FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
    `);

    // Migrate data from old instance_user_permissions table if it exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'genrpg' AND table_name = 'instance_user_permissions'
      ) AS table_exists;
    `);

    if (tableCheck.rows[0].table_exists) {
      await client.query(`
        INSERT INTO genrpg.instance_user_roles (instance_guid, user_guid, role_id, create_datetime, update_datetime)
        SELECT
          iup.instance_guid,
          iup.user_guid,
          r.id,
          iup.create_datetime,
          iup.update_datetime
        FROM genrpg.instance_user_permissions iup
        JOIN genrpg.roles r ON r.name = CASE iup.permission
          WHEN 'Owner' THEN 'Instance_Owner'
          WHEN 'Editor' THEN 'Instance_GM'
          WHEN 'Viewer' THEN 'Instance_Player'
          ELSE 'Instance_Player'
        END
        ON CONFLICT (instance_guid, user_guid) DO NOTHING;
      `);

      await client.query(`DROP TABLE genrpg.instance_user_permissions;`);
    }
  },

  3: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS genrpg.item_templates (
        guid uuid PRIMARY KEY,
        instance_guid uuid NOT NULL REFERENCES genrpg.instances(guid) ON DELETE CASCADE,
        name text NOT NULL,
        description text,
        weight double precision,
        create_datetime timestamptz NOT NULL DEFAULT now(),
        update_datetime timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_item_templates_instance
        ON genrpg.item_templates(instance_guid);
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS item_templates_update_datetime ON genrpg.item_templates;
      CREATE TRIGGER item_templates_update_datetime
        BEFORE UPDATE ON genrpg.item_templates
        FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
    `);
  },

  4: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS genrpg.url_aliases (
        guid uuid PRIMARY KEY,
        alias text NOT NULL UNIQUE,
        path text NOT NULL,
        create_datetime timestamptz NOT NULL DEFAULT now(),
        update_datetime timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_url_aliases_path ON genrpg.url_aliases(path);
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS url_aliases_update_datetime ON genrpg.url_aliases;
      CREATE TRIGGER url_aliases_update_datetime
        BEFORE UPDATE ON genrpg.url_aliases
        FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
    `);
    await client.query(`
      INSERT INTO genrpg.url_aliases (guid, alias, path)
      SELECT gen_random_uuid(), 'instance/' || guid::text, 'instance:' || guid::text
      FROM genrpg.instances
      ON CONFLICT (alias) DO NOTHING;
    `);
  },
};
