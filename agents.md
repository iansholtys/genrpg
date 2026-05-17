# GenRPG Architecture & Agent Guide

Welcome to the `genrpg` repository! This document provides essential context and architectural details for AI coding agents working on this project. 

## Tech Stack Overview
- **Backend Environment:** Node.js (v20+)
- **Web Framework:** Express.js
- **Database:** PostgreSQL (with `pg` and `connect-pg-simple` for session management)
- **Styling:** SCSS compiled to Vanilla CSS
- **Authentication:** OpenID Connect (`openid-client`)
- **Package/Module System:** Git-based packages

## Repository Structure & Core Systems

### 1. The Package System (Extensibility)
GenRPG is designed to be highly extensible. Core functionality exists in the main repository, but additional features and systems are pulled down as separate Git repositories into the `packages/` directory.
- **Location:** `packages/<package-name>/`
- **Mechanism:** The backend endpoints clone/pull git repositories into this directory.
- **Metadata:** Each package defines a `*.package.yml` file which contains its metadata. `src/packages.js` and `src/updates.js` are responsible for managing these packages, extracting metadata, and comparing semantic versions to apply updates.
- **Important:** When adding features that are meant to be modular, consider if they belong in a separate package repository rather than the core GenRPG repo.

### 2. Database & Updates
Use **PostgreSQL**
- **Where SQL files live:**
  - Core schema: `genrpg/db/<order>_<name>.sql` (e.g., `genrpg/db/0001_initial.sql`)
  - Package schema: `packages/<package-name>/db/<order>_<name>.sql`
- **Update Logic:** `src/db/versions.js` automatically discovers these directories, and applies the `.sql` scripts in order. It tracks applied updates in a `schema_versions` table. It also should handle the creation of the schema matching the package's `machine_name` if the schema doesn't already exist.
- **Running Updates:** Use `npm run db:apply`
- **Fully qualify SQL queries:** Always qualify your SQL queries.
  - Core schema: `genrpg.*` - Do not use the `public` schema for the core schema, rather use the `genrpg` schema.
  - Package schema: `<machine-name>.*` - Do not use the `public` schema for package schema, rather use the `<machine-name>` schema which matches the package's `machine_name`.

### 3. Styling (SCSS to CSS)
We use compiled SCSS for styling to maintain a modern, rich aesthetic.
- **Location:** Source files are in `public/scss/`. Compiled output goes to `public/css/`.
- **Workflow:** When modifying styles, **always edit the `.scss` files**. Do not directly edit the generated `.css` files.
- **Commands:**
  - Build CSS: `npm run build:css`
  - Watch for changes: `npm run watch:css`

### 4. Docker & Infrastructure
- The application is containerized using `docker-compose.yml` and a `Dockerfile`.
- The `app` service depends on the `postgres` service.
- The `Dockerfile` includes `git` to support the Git-based package management system.
- Environment variables are managed via `.env` (see `.env.example`).

## Guidelines for AI Agents
1. **Understand the Package Boundary:** Make sure you know whether the code you are modifying belongs to the core GenRPG system (`src/`) or a specific package.
2. **Follow SCSS Workflows:** If asked to update styles, locate the corresponding `public/scss/` file, make changes, and remind the user to run `npm run build:css` or `npm run watch:css`.
3. **Database Changes:** The `db/*.sql` files define database changes (creating/modifying tables, etc.) needed for a fresh install of a Package. As storage requirements change, these files should be updated to stay current. For existing installs, a `*.updates.js` file must be provided which applies the same changes.
4. For example, if a new version of a Package requires a new column on a table that Package creates, the corresponding `*.sql` file should be updated to include that column when doing the `CREATE TABLE`, and the `*.updates.js` file should get an update function with an `ALTER TABLE` command. Update functions may be more complicated if the schema changes enough that data must be migrated, e.g. splitting one table into several or changing a column type.
5. **No Tailwind:** Rely on our existing SCSS pipeline. Do not introduce TailwindCSS unless explicitly requested.
6. **Node/Express Idioms:** Stick to the existing vanilla JS and Express patterns found in `src/server.js` and other routes.
