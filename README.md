# GenRPG

GenRPG is a Docker-served web app protected by OIDC login.

## Configuration

Copy `.env.example` to `.env` and fill in the OIDC and database values.

Required OIDC settings:

- `OIDC_CONFIGURATION_URL`: provider discovery URL, such as Authentik's `.well-known/openid-configuration` URL.
- `OIDC_CLIENT_ID`: OIDC client id.
- `OIDC_CLIENT_SECRET`: OIDC client secret.
- `APP_BASE_URL`: public base URL for this app.
- `SESSION_SECRET`: long random secret for signed sessions.

Optional OIDC settings:

- `OIDC_REDIRECT_URI`: exact callback URI when `APP_BASE_URL/auth/callback` is not enough.
- `OIDC_SCOPES`: defaults to `openid email profile`.
- `ADMIN_EMAILS`: comma-separated emails promoted to GenRPG admins on login.

Admins inherently have `Instance_Owner`-level access to all instances. Non-admin users only see instances where they have a role assignment in `instance_user_roles`.

GenRPG ships three built-in roles:

| Role | Permissions |
|------|------------|
| `Instance_Owner` | Full control: edit, delete, run, manage packages, manage users |
| `Instance_GM` | Same as Owner, but cannot assign or remove the `Instance_Owner` role |
| `Instance_Player` | Can run/enter the instance |

## Reusable UI components

Shared jQuery components live in a [git submodule](https://github.com/iansholtys/reusable-components) at `public/components/reusable`.

After cloning this repository:

```sh
git submodule update --init --recursive
```

Or clone with submodules in one step:

```sh
git clone --recurse-submodules <repo-url>
```

You can also run `npm run submodules`. Docker builds expect the submodule to be checked out on the host before `docker build` (the `public/` copy includes those files).

## Run

```sh
npm run submodules
docker compose up --build
```

Configure the OIDC provider redirect/callback URI as:

```text
<APP_BASE_URL>/auth/callback
```

## Database Versions

Database schema changes live in SQL files grouped by semantic version instead of application startup code. A version directory can contain multiple ordered files so contributors can keep related changes readable while still tying them to a GenRPG or package release.

GenRPG platform version files belong in:

```text
genrpg/db/<semver>/
```

Package version files belong in:

```text
packages/<package-name>/db/<semver>/
```

Version directories use semantic versioning, and SQL filenames inside each version use:

```text
<sequence>_<description>.sql
```

Example:

```text
genrpg/db/0.0.1/0001_session_table.sql
```

Use a leading SQL comment inside the version file for the creation date:

```sql
-- Created: 2026-05-16
```

The app applies GenRPG versions first, then package versions sorted by package name, semantic version, and filename. File sequence numbers must be unique within a version directory. Applied files are recorded in `schema_versions` with package name, semantic version, file name, checksum, and apply time. If an already-applied version file is edited later, startup fails instead of silently drifting the database.

Run schema versions directly with:

```sh
npm run db:apply
```

The server also applies pending schema versions on startup before listening for requests.

## Database Table Conventions

All database tables (core and package) **must** include the following timestamp columns:

```sql
create_datetime timestamptz NOT NULL DEFAULT now(),
update_datetime timestamptz NOT NULL DEFAULT now()
```

Each table must also have an associated trigger to automatically maintain `update_datetime`:

```sql
DROP TRIGGER IF EXISTS <table_name>_update_datetime ON <schema>.<table_name>;
CREATE TRIGGER <table_name>_update_datetime
  BEFORE UPDATE ON <schema>.<table_name>
  FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
```

## Entity references

We do not yet have a general solution for loading referenced entities on demand (for example, hydrating `entityRef` or structured field refs when an entity is loaded). Call sites that need related entities should load them explicitly with storage `load()` / `list()` as needed. A cleaner shared approach is still TBD.

