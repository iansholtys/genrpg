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

Admins can see all instances. Non-admin users only see instances where they have an `Owner`, `Editor`, or `Viewer` row in `instance_user_permissions`.

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
