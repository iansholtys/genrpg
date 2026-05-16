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

## Run

```sh
docker compose up --build
```

Configure the OIDC provider redirect/callback URI as:

```text
<APP_BASE_URL>/auth/callback
```
