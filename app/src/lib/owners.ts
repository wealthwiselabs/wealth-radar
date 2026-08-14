// Who this instance's accounts belong to.
//
// An account's `owner` is a free-text tag describing whose bank login a record
// came from. This module is the single source of truth for the selectable
// values shown in the UI and accepted by the API.
//
// Configure the people via NEXT_PUBLIC_ACCOUNT_OWNERS in `.env.local`, e.g.
//   NEXT_PUBLIC_ACCOUNT_OWNERS="Alex,Sam"
// The prefix must be NEXT_PUBLIC_ so the list is available in client components
// as well as on the server. "Joint" is always appended for shared accounts.

const configured = (process.env.NEXT_PUBLIC_ACCOUNT_OWNERS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** The people whose accounts this instance tracks (excludes "Joint"). */
export const OWNER_PEOPLE: readonly string[] =
  configured.length > 0 ? configured : ['Person 1', 'Person 2'];

/**
 * Assignable owners: each person plus "Joint". Used where an owner is REQUIRED
 * (e.g. connecting a bank login).
 */
export const ACCOUNT_OWNERS: readonly string[] = [...OWNER_PEOPLE, 'Joint'];

/**
 * Owner options for edit dropdowns, including the empty "unassigned" value.
 */
export const ACCOUNT_OWNER_OPTIONS: readonly string[] = ['', ...ACCOUNT_OWNERS];
