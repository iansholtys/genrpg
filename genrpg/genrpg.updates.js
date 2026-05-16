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
};
