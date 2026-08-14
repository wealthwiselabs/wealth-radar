# Contributing

Thanks for your interest! This is a small, self-hosted project — feedback and PRs are
welcome.

## Where things go

- **Bugs & feature requests** → open an [issue](../../issues/new/choose) (templates provided).
- **Questions & ideas** → use [Discussions](../../discussions) rather than issues.
- **Security vulnerabilities** → **do not** open a public issue; see [SECURITY.md](SECURITY.md).

## Development

The app lives in [`app/`](app/). See the [README](README.md) for setup.

```bash
cd app
npm install
npm run db:migrate
npm run dev          # http://localhost:3000
```

Before opening a PR, please make sure the checks pass (the same ones CI runs):

```bash
npx tsc --noEmit     # typecheck
npm test             # unit tests (vitest)
npm run build        # production build
```

The project uses test-driven development — add or update tests alongside changes, and use
`makeTmpDb()` (never the real database) in tests. Don't commit real financial data,
secrets, or `.env*` files.
