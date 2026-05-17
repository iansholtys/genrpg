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

### 2. Database & Migrations
We use **PostgreSQL**. The database schema is version-controlled using a custom migration system.
- **Where SQL files live:**
  - Core schema: `genrpg/db/<semver>/<order>_<name>.sql` (e.g., `genrpg/db/1.0.0/0001_initial.sql`)
  - Package schema: `packages/<package-name>/db/<semver>/<order>_<name>.sql`
- **Migration Logic:** `src/db/versions.js` automatically discovers these directories, parses semantic versions, and applies the `.sql` scripts in order. It tracks applied migrations in a `schema_versions` table.
- **Running Migrations:** Use `npm run db:apply`.

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
3. **Database Changes:** To add a database table or column, create a new `.sql` file in the appropriate `db/<semver>/` directory with the correct `<sequence>_<name>.sql` format. Never modify existing migration files that have already been applied.
4. **No Tailwind:** Rely on our existing SCSS pipeline. Do not introduce TailwindCSS unless explicitly requested.
5. **Node/Express Idioms:** Stick to the existing vanilla JS and Express patterns found in `src/server.js` and other routes.
