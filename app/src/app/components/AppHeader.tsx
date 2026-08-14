'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import GapsBadge from './GapsBadge';
import SettingsButton from './SettingsButton';
import { Logo } from './Logo';

// Order follows how often these are visited, not the URL hierarchy: the money
// views first, then the things you configure. `activeHref` picks the longest
// matching prefix, so /investments/reserve still highlights Reserve rather than
// Investments regardless of where either sits in this list.
const NAV = [
  { href: '/', label: 'Home' },
  { href: '/investments', label: 'Investments' },
  { href: '/investments/reserve', label: 'Reserve' },
  { href: '/accounts', label: 'Accounts' },
  { href: '/rules', label: 'Rules' },
];

/**
 * Site chrome: the same nav on every page, so navigation doesn't depend on
 * whichever one-off link a given page happened to render.
 *
 * The gaps badge lives here rather than on the home page because missing
 * statement months are a global signal — it's hidden on /accounts, where the
 * coverage grid it points at is already on screen.
 */
export default function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();

  // The login screen is its own full-page layout — no app chrome.
  if (pathname === '/login') return null;

  // active = the longest NAV href that prefixes the current path
  const activeHref = NAV.filter((n) =>
    n.href === '/' ? pathname === '/' : pathname === n.href || pathname.startsWith(n.href + '/')
  ).sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <header className="border-b border-[var(--color-border-base-subdued)] bg-[var(--color-background-base-default)] sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-[var(--space-6)] py-[var(--space-3)] flex items-center gap-[var(--space-4)] flex-wrap">
        <Link href="/" className="no-underline">
          <Logo variant="tile" size={24} />
        </Link>

        <nav className="flex items-center gap-[var(--space-1)]" aria-label="Main">
          {NAV.map((item) => {
            const active = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className="px-[var(--space-3)] py-[var(--space-1)] rounded-[var(--radius-2)] text-small no-underline"
                style={{
                  background: active ? 'var(--color-background-base-subdued)' : 'transparent',
                  color: active
                    ? 'var(--color-text-base-default)'
                    : 'var(--color-text-base-subdued)',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-[var(--space-3)] ml-auto">
          {pathname !== '/accounts' && <GapsBadge onOpen={() => router.push('/accounts')} />}
          <SettingsButton />
        </div>
      </div>
    </header>
  );
}
