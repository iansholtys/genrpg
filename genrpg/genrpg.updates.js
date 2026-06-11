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

  5: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS genrpg.items (
        guid uuid PRIMARY KEY,
        instance_guid uuid NOT NULL REFERENCES genrpg.instances(guid) ON DELETE CASCADE,
        item_template_guid uuid NOT NULL REFERENCES genrpg.item_templates(guid) ON DELETE RESTRICT,
        name text,
        description text,
        weight double precision,
        create_datetime timestamptz NOT NULL DEFAULT now(),
        update_datetime timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_items_instance
        ON genrpg.items(instance_guid);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_items_template
        ON genrpg.items(item_template_guid);
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS items_update_datetime ON genrpg.items;
      CREATE TRIGGER items_update_datetime
        BEFORE UPDATE ON genrpg.items
        FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
    `);
  },

  6: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS genrpg.characters (
        guid uuid PRIMARY KEY,
        instance_guid uuid NOT NULL REFERENCES genrpg.instances(guid) ON DELETE CASCADE,
        user_guid uuid REFERENCES genrpg.users(guid) ON DELETE SET NULL,
        display_name text,
        full_name text,
        appearance text,
        pronouns text,
        create_datetime timestamptz NOT NULL DEFAULT now(),
        update_datetime timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS characters_update_datetime ON genrpg.characters;
      CREATE TRIGGER characters_update_datetime
        BEFORE UPDATE ON genrpg.characters
        FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS genrpg.item_collections (
        guid uuid PRIMARY KEY,
        instance_guid uuid NOT NULL REFERENCES genrpg.instances(guid) ON DELETE CASCADE,
        type text NOT NULL,
        name text,
        item_guid uuid REFERENCES genrpg.items(guid) ON DELETE SET NULL,
        capacity_used double precision,
        capacity_max double precision,
        create_datetime timestamptz NOT NULL DEFAULT now(),
        update_datetime timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_item_collections_instance
        ON genrpg.item_collections(instance_guid);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_item_collections_item
        ON genrpg.item_collections(item_guid);
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS item_collections_update_datetime ON genrpg.item_collections;
      CREATE TRIGGER item_collections_update_datetime
        BEFORE UPDATE ON genrpg.item_collections
        FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS genrpg.item_collection_contents (
        guid uuid PRIMARY KEY,
        instance_guid uuid NOT NULL REFERENCES genrpg.instances(guid) ON DELETE CASCADE,
        collection_guid uuid NOT NULL REFERENCES genrpg.item_collections(guid) ON DELETE CASCADE,
        item_guid uuid REFERENCES genrpg.items(guid) ON DELETE CASCADE,
        subcollection_guid uuid REFERENCES genrpg.item_collections(guid) ON DELETE CASCADE,
        quantity integer NOT NULL DEFAULT 1,
        position integer NOT NULL DEFAULT 0,
        create_datetime timestamptz NOT NULL DEFAULT now(),
        update_datetime timestamptz NOT NULL DEFAULT now(),
        CHECK (
          (item_guid IS NOT NULL AND subcollection_guid IS NULL)
          OR (item_guid IS NULL AND subcollection_guid IS NOT NULL)
        ),
        CHECK (quantity >= 0)
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_item_collection_contents_collection
        ON genrpg.item_collection_contents(collection_guid);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_item_collection_contents_item
        ON genrpg.item_collection_contents(item_guid);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_item_collection_contents_subcollection
        ON genrpg.item_collection_contents(subcollection_guid);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_item_collection_contents_collection_position
        ON genrpg.item_collection_contents(collection_guid, position);
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS item_collection_contents_update_datetime ON genrpg.item_collection_contents;
      CREATE TRIGGER item_collection_contents_update_datetime
        BEFORE UPDATE ON genrpg.item_collection_contents
        FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS genrpg.inventories (
        guid uuid PRIMARY KEY,
        instance_guid uuid NOT NULL REFERENCES genrpg.instances(guid) ON DELETE CASCADE,
        collection_guid uuid NOT NULL REFERENCES genrpg.item_collections(guid) ON DELETE CASCADE,
        character_guid uuid NOT NULL REFERENCES genrpg.characters(guid) ON DELETE CASCADE,
        create_datetime timestamptz NOT NULL DEFAULT now(),
        update_datetime timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_inventories_instance
        ON genrpg.inventories(instance_guid);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_inventories_character
        ON genrpg.inventories(character_guid);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_inventories_collection
        ON genrpg.inventories(collection_guid);
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS inventories_update_datetime ON genrpg.inventories;
      CREATE TRIGGER inventories_update_datetime
        BEFORE UPDATE ON genrpg.inventories
        FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
    `);
  },

  7: async (client) => {
    await client.query(`
      WITH chars_needing_inventory AS (
        SELECT
          c.guid AS character_guid,
          c.instance_guid,
          gen_random_uuid() AS collection_guid
        FROM genrpg.characters c
        WHERE NOT EXISTS (
          SELECT 1
          FROM genrpg.inventories i
          WHERE i.character_guid = c.guid
        )
      ),
      inserted_collections AS (
        INSERT INTO genrpg.item_collections (guid, instance_guid, type, name)
        SELECT collection_guid, instance_guid, 'inventory', NULL
        FROM chars_needing_inventory
        RETURNING guid
      )
      INSERT INTO genrpg.inventories (guid, instance_guid, collection_guid, character_guid)
      SELECT gen_random_uuid(), instance_guid, collection_guid, character_guid
      FROM chars_needing_inventory;
    `);
  },

  8: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS genrpg.cache (
        cache_key text NOT NULL,
        instance_guid uuid REFERENCES genrpg.instances(guid) ON DELETE CASCADE,
        value jsonb NOT NULL,
        cached_datetime timestamptz NOT NULL DEFAULT now(),
        UNIQUE NULLS NOT DISTINCT (cache_key, instance_guid)
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_cache_instance ON genrpg.cache(instance_guid)
        WHERE instance_guid IS NOT NULL;
    `);
  },

  9: async (client) => {
    const tables = [
      "genrpg.users",
      "genrpg.instances",
      "genrpg.characters",
      "genrpg.item_templates",
      "genrpg.items",
      "genrpg.url_aliases",
      "genrpg.item_collections",
      "genrpg.item_collection_contents",
      "genrpg.inventories",
    ];

    for (const table of tables) {
      await client.query(`
        ALTER TABLE ${table}
          ALTER COLUMN guid SET DEFAULT gen_random_uuid();
      `);
    }
  },

  10: async (client) => {
    await client.query(`
      CREATE OR REPLACE FUNCTION genrpg.set_cached_datetime()
      RETURNS trigger AS $$
      BEGIN
        NEW.cached_datetime = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS cache_cached_datetime ON genrpg.cache;
      CREATE TRIGGER cache_cached_datetime
        BEFORE UPDATE ON genrpg.cache
        FOR EACH ROW EXECUTE FUNCTION genrpg.set_cached_datetime();
    `);
  },

  11: async (client) => {
    await client.query(`
      CREATE OR REPLACE FUNCTION genrpg.set_applied_at()
      RETURNS trigger AS $$
      BEGIN
        NEW.applied_at = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS schema_versions_applied_at ON schema_versions;
      CREATE TRIGGER schema_versions_applied_at
        BEFORE UPDATE ON schema_versions
        FOR EACH ROW EXECUTE FUNCTION genrpg.set_applied_at();
    `);
  },
};
