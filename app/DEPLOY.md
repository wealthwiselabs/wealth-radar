# Deploying to Fly.io

This app runs as a single always-available instance on [Fly.io](https://fly.io), keeping its
SQLite database on a persistent volume. Files involved: [`Dockerfile`](Dockerfile),
[`.dockerignore`](.dockerignore), [`fly.toml`](fly.toml). All commands below run from the
`app/` directory.

Rough cost: **~$2–5/month** (a small shared-cpu machine that scales to zero when idle, plus
~$0.15/GB-month for the volume).

## 1. One-time setup

**Install the CLI and sign in:**

```bash
brew install flyctl
fly auth signup   # or: fly auth login
```

**Edit [`fly.toml`](fly.toml):**
- `app` — pick a globally-unique name (e.g. `smith-expenses`).
- `primary_region` — the airport code nearest you (`fly platform regions` lists them).
- `NEXT_PUBLIC_ACCOUNT_OWNERS` under `[build.args]` — your and your wife's names, e.g.
  `"Alex,Sam"`. (This is baked into the UI at build time, so changing it later means a
  redeploy.)

**Create the app and its volume** (the volume holds `app.db`, so create it in the same
region as `primary_region`):

```bash
fly apps create <your-app-name>
fly volumes create expense_data --size 1 --region <your-region>   # 1 GB
```

**Set your secrets** (these are runtime env vars, kept encrypted by Fly — never put them in
`fly.toml`):

```bash
# Classification (optional — you can instead paste a key in the app's Settings dialog):
fly secrets set ANTHROPIC_API_KEY=sk-ant-...

# Only if you use Plaid bank sync:
fly secrets set \
  APP_ENCRYPTION_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" \
  PLAID_CLIENT_ID=... \
  PLAID_ENV=production \
  PLAID_SECRET_PRODUCTION=...
```

> ⚠️ If you're migrating an existing database that already has Plaid connections, set
> `APP_ENCRYPTION_KEY` to the **same** key your local `.env.local` used — otherwise the
> stored bank tokens can't be decrypted and you'll have to reconnect each bank.

**Deploy:**

```bash
fly deploy
```

The container runs database migrations on startup, then serves on port 3000 (Fly maps it to
HTTPS automatically). Open it with `fly open`.

## 2. Moving your existing data over (optional)

Your current data is in `app/data/app.db` on your own machine. To carry it up:

```bash
# 1. Locally, fold the WAL into the main file so app.db is self-contained:
sqlite3 data/app.db "PRAGMA wal_checkpoint(TRUNCATE);"

# 2. Upload it onto the volume:
fly ssh sftp shell
#   at the prompt:
put ./data/app.db /data/app.db
bye

# 3. Clear the stale WAL/SHM from the empty DB the app first created, then restart:
fly ssh console -C "rm -f /data/app.db-wal /data/app.db-shm"
fly apps restart <your-app-name>
```

Migrations re-run on restart and are idempotent, so an older-schema upload is brought
up to date automatically. Do this before anyone starts using the deployed app.

## 3. Access control — shared login gate (built in)

The app ships a built-in login gate (`src/middleware.ts` + `src/lib/auth.ts`). It protects
**every page and API route**, including the raw `*.fly.dev` URL, so there's no bypass to
worry about and no domain required.

**It fails closed in production:** a deployed build with no `AUTH_PASSWORD` set refuses to
serve at all (HTTP 503) rather than exposing data — so a forgotten password can't silently
leave everything open. Set the password to turn it into a normal login:

```bash
fly secrets set \
  AUTH_PASSWORD='<a strong shared password>' \
  AUTH_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" \
  --app <your-app-name>
```

- `AUTH_USERNAME` is set (non-secret) in `fly.toml` `[env]`; leave it out for a
  password-only gate.
- `AUTH_SECRET` signs the session cookie; it falls back to `AUTH_PASSWORD` if unset, so it's
  optional — but setting a distinct one is better.
- A correct login sets a 30-day `HttpOnly; Secure; SameSite=Lax` cookie. Sign out by POSTing
  to `/api/auth/logout`.
- To intentionally run a production deploy **open** (e.g. behind a VPN), set
  `AUTH_DISABLED=true`. Otherwise production without a password stays blocked.

You and your wife share one username/password. Share the app URL plus those credentials.

### Optional: Cloudflare Access instead of / on top of the built-in gate

If you'd rather have per-person SSO (Google/email login, no shared password), put the app
behind Cloudflare Access on a domain you control — it layers cleanly over the built-in gate:

1. **DNS** (Cloudflare → your domain → DNS): CNAME `expenses` → `<your-app-name>.fly.dev`,
   **Proxied** (orange cloud).
2. **SSL/TLS → Overview**: **Full (strict)** (Fly serves a valid cert on its `.fly.dev` name).
3. **Zero Trust → Access → Applications → Add → Self-hosted**: application domain
   `expenses.wealthwiselabs.com`.
4. Policy: **Allow**, include **Emails** → your two addresses.

With the built-in gate already covering the `.fly.dev` URL, the domain is a nicety, not a
requirement.

## 4. Continuous deployment (GitHub Actions)

`.github/workflows/ci-cd.yml` runs CI on every pull request (typecheck, unit tests, build)
and, on merge to `main`, **auto-deploys to Fly.io — but only after CI passes.** Pull
requests and forks never deploy (a fork also lacks the secrets below).

One-time setup — add two repository secrets (GitHub → Settings → Secrets and variables →
Actions):

1. **`FLY_API_TOKEN`** — a scoped deploy token:
   ```bash
   fly tokens create deploy -a wealthwiselabs-tracker
   ```
   Paste the output as the secret's value.
2. **`ACCOUNT_OWNERS`** — the real owner names, e.g. `Alex,Sam`. These are injected
   into the build at deploy time so no personal names live in the repo (`fly.toml` ships a
   generic `Person 1,Person 2`).

Set **both** secrets before the first auto-deploy, or the deployed app will show the
generic names until you do. After that, every merge to `main` redeploys with no manual
step. (A manual `fly deploy` still works for emergencies — pass
`--build-arg NEXT_PUBLIC_ACCOUNT_OWNERS="Alex,Sam"` to keep the real names.)

## 5. Everyday operations

```bash
fly deploy                    # ship code changes
fly logs                      # tail logs
fly ssh console               # shell into the machine (DB is at /data/app.db)
fly apps restart <app-name>   # restart

# Back up the live DB to your laptop:
fly ssh console -C "sqlite3 /data/app.db \".backup '/data/backup.db'\""
fly ssh sftp get /data/backup.db ./app-db-backup.db
```

## Notes & gotchas

- **Keep it to one machine.** A Fly volume attaches to a single machine and file-based
  SQLite isn't safe for concurrent writers across machines. Don't `fly scale count 2`.
- **Auto-stop.** With `min_machines_running = 0` the machine sleeps when idle and cold-starts
  in a few seconds on the next request. The 12-hour background Plaid sync only fires while
  the machine is awake — if you want it to run reliably, set `min_machines_running = 1` in
  `fly.toml` (slightly higher cost).
- **`NEXT_PUBLIC_ACCOUNT_OWNERS` is build-time.** Changing owners means editing `fly.toml`
  and running `fly deploy` again.
