module.exports = {
  1: async (client) => {
    await client.query(`
      ALTER TABLE genrpg.packages
        ADD COLUMN IF NOT EXISTS install_version integer NOT NULL DEFAULT 0;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS genrpg.instance_package_install (
        instance_guid uuid NOT NULL REFERENCES genrpg.instances(guid) ON DELETE CASCADE,
        package text NOT NULL REFERENCES genrpg.packages(package) ON DELETE CASCADE,
        install_version integer NOT NULL DEFAULT 0,
        create_datetime timestamptz NOT NULL DEFAULT now(),
        update_datetime timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (instance_guid, package)
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_instance_package_install_package
        ON genrpg.instance_package_install(package);
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS instance_package_install_update_datetime ON genrpg.instance_package_install;
      CREATE TRIGGER instance_package_install_update_datetime
        BEFORE UPDATE ON genrpg.instance_package_install
        FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
    `);
  },
};
