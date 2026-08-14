import { LogoMark } from '@/app/components/Logo';

export const metadata = { title: 'Sign in · Wealthwise' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const { from, error } = await searchParams;

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-4)',
        background:
          'radial-gradient(120% 80% at 50% -10%, var(--color-background-brand-subdued) 0%, transparent 55%)',
      }}
    >
      <div
        className="origin-card-elevated"
        style={{
          width: '100%',
          maxWidth: '360px',
          padding: 'var(--space-8)',
          borderRadius: 'var(--radius-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-5)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)', textAlign: 'center' }}>
          <LogoMark variant="tile" size={48} />
          <div>
            <h1 className="heading-small" style={{ color: 'var(--color-text-base-default)' }}>
              Wealthwise
            </h1>
            <p className="text-small" style={{ color: 'var(--color-text-base-subdued)', marginTop: 'var(--space-1)' }}>
              Sign in to continue
            </p>
          </div>
        </div>

        {error ? (
          <p
            role="alert"
            className="text-xsmall"
            style={{
              color: 'var(--color-text-critical)',
              background: 'var(--color-background-critical-subdued)',
              border: '1px solid var(--color-border-critical)',
              borderRadius: 'var(--radius-2)',
              padding: 'var(--space-2) var(--space-3)',
            }}
          >
            Incorrect username or password.
          </p>
        ) : null}

        <form method="POST" action="/api/auth/login" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <input type="hidden" name="from" value={from ?? '/'} />

          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <span className="text-xsmall" style={{ color: 'var(--color-text-base-subdued)' }}>
              Username
            </span>
            <input name="username" autoComplete="username" className="origin-input" aria-label="Username" />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <span className="text-xsmall" style={{ color: 'var(--color-text-base-subdued)' }}>
              Password
            </span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="origin-input"
              aria-label="Password"
            />
          </label>

          <button
            type="submit"
            className="origin-btn origin-btn-primary"
            style={{ width: '100%', marginTop: 'var(--space-1)' }}
          >
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
