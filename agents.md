# GenRPG Architecture & Agent Guide

This document provides essential context and architectural details for AI coding agents working on this project.

## Tech Stack Overview
- **Backend Environment:** Node.js (v20+)
- **Web Framework:** Express.js
- **Database:** PostgreSQL (with `pg` and `connect-pg-simple` for session management)
- **Styling:** SCSS compiled to CSS
- **Authentication:** OpenID Connect (`openid-client`)

## Repository Structure & Core Systems

### 1. Extensibility (Package system)
GenRPG is highly extensible. The main repository includes core functionality such as auth and database storage, with additional features and systems provided by separate Git repositories in the `packages/` directory.

- **Location:** `packages/<package-name>/`
- **Mechanism:** GenRPG clones/pulls git repositories into this directory.
- **Dependencies:** Packages can build on the functionality of other packages. To ensure a Package is available, it can be listed as a requirement, including a semantic version.
- **Metadata:** Each package defines a `*.package.yml` file which contains its metadata, including version and requirements. `src/packages.js` and `src/updates.js` manage these packages, extract metadata, compare semantic versions and apply updates.

### 2. Database & Updates
Use **PostgreSQL**
- **Where SQL files live:**
  - Core schema: `genrpg/db/<order>_<name>.sql` (e.g., `genrpg/db/0001_initial.sql`)
  - Package schema: `packages/<package-name>/db/<order>_<name>.sql`
- **Update Logic:** `src/db/versions.js` automatically discovers these directories, and applies the `.sql` scripts in order. It tracks applied updates in a `schema_versions` table. It also should handle the creation of the schema matching the package's `machine_name` if the schema doesn't already exist.
- **Existing installs:** Put additive or altering changes in `packages/<name>/<name>.updates.js` (numbered steps). The `db/*.sql` files are for fresh installs and are only auto-applied once unless an admin uses **Reinstall** in Manage Packages, which re-runs all package SQL from disk plus `*.updates.js` steps.
- **Running Updates:** Use `npm run db:apply` for pending schema files; use Manage Packages **Reinstall** or the package update API for a full package SQL + updates replay.
- **Fully qualify SQL queries:** Always qualify your SQL queries.
  - Core schema: `genrpg.*` - Do not use the `public` schema for the core schema, rather use the `genrpg` schema.
  - Package schema: `<machine-name>.*` - Do not use the `public` schema for package schema, rather use the `<machine-name>` schema which matches the package's `machine_name`.

### 3. Styling (SCSS to CSS)
Styling is written in SCSS for brevity and consistency before being compiled into CSS.

- **Location:** GenRPG core and Packages can use their own conventions with how they store SCSS and CSS files.
  - For GenRPG, global styling is usually stored in `public/scss/` and `public/css`.
  - For Packages, it is common to have separate directories for each UI component, each containing the JS, SCSS and CSS for that component.
- **Workflow:** When modifying styles, **always edit the `.scss` files**. Do not directly edit the generated `.css` files.
- **Commands:**
  - Build CSS: `npm run build:css`
  - Watch for changes: `npm run watch:css`

### 4. Entity API layer
Instance-scoped CRUD (items, characters, inventory, etc.) uses a shared entity layer under `src/entities/`, `src/services/`, and `src/storage/`. See [docs/entity-api.md](docs/entity-api.md) for the handler contract, permission map, and how to add new entity types.

### 5. Docker & Infrastructure
- The application is containerized using `docker-compose.yml` and a `Dockerfile`.
- The `app` service depends on the `postgres` service.
- The `Dockerfile` includes `git` to support the Git-based package management system.
- Environment variables are managed via `.env` (see `.env.example`).

## Guidelines for AI Agents

1. **Understand the Package Boundary:** Make sure you know whether the code you are modifying belongs to the core GenRPG system (`src/`) or a specific Package.
2. **Follow SCSS Workflows:** If asked to update styles, locate the corresponding SCSS file(s), make changes, and run `npm run build:css`.
3. **Database Changes:** The `db/*.sql` files define database changes (creating/modifying tables, etc.) needed for a fresh install of a Package. As storage requirements change, these files should be updated to stay current. For existing installs, a `*.updates.js` file must be provided which applies the same changes.
  1. For example, if a new version of a Package requires a new column on a table that Package creates, the corresponding `*.sql` file should be updated to include that column when doing the `CREATE TABLE`, and the `*.updates.js` file should get an update function with an `ALTER TABLE` command. Update functions may be more complicated if the schema changes enough that data must be migrated, e.g. splitting one table into several or changing a column type.
4. **Table Timestamp Columns:** All database tables must include `create_datetime timestamptz NOT NULL DEFAULT now()` and `update_datetime timestamptz NOT NULL DEFAULT now()` columns, with an associated `BEFORE UPDATE` trigger using `genrpg.set_update_datetime()`.
5. **No Tailwind:** Do not introduce TailwindCSS unless explicitly requested.
6. **Node/Express Idioms:** Stick to the existing vanilla JS and Express patterns found in `src/server.js` and other routes.
7. **Instance-scoped APIs:** For new resources, add entity and storage modules; orchestrate CRUD in the API router using `assertInstancePermissions` from [`src/api/instanceContext.js`](src/api/instanceContext.js) and `withTransaction` from [`src/api/items.js`](src/api/items.js). Throw `NotFoundError`, `PermissionError`, `BadRequestError`, or `ValidationError` as appropriate; use `HttpError` only for other HTTP statuses. Keep SQL in storage.
