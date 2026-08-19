export interface ViewSection {
  id: string;
  order?: number;
  title: string;
  summary: string;
  detail?: { tool: string; args?: Record<string, unknown> };
}

export interface ViewSnapshot {
  route: string;
  label: string;
  timeRange?: string;
  filters?: Record<string, string>;
  highlights: { label: string; value: string }[];
  sections?: ViewSection[];
}

export type ViewBase = Omit<ViewSnapshot, 'sections'>;

let base: ViewBase | null = null;
const sections = new Map<string, ViewSection>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

/** Publish the page-level base. A route change resets sections so stale
 *  sections from the previous page cannot leak. Passing null clears everything. */
export function setViewBase(b: ViewBase | null): void {
  if (b === null) {
    base = null;
    sections.clear();
    notify();
    return;
  }
  if (!base || base.route !== b.route) sections.clear();
  base = b;
  notify();
}

export function setViewSection(section: ViewSection): void {
  sections.set(section.id, section);
  notify();
}

export function removeViewSection(id: string): void {
  if (sections.delete(id)) notify();
}

export function getViewContext(): ViewSnapshot | null {
  if (!base) return null;
  const list = [...sections.values()].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id),
  );
  return { ...base, sections: list };
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const MAX_HIGHLIGHTS = 8;
const MAX_SECTIONS = 12;
const MAX_SUMMARY_LEN = 160;

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function formatViewContext(s: ViewSnapshot | null): string {
  if (!s) return '';

  const lines: string[] = [];
  lines.push(`The user is viewing ${s.label} (${s.route})`);

  if (s.timeRange) lines.push(`Time range: ${s.timeRange}`);

  if (s.filters && Object.keys(s.filters).length > 0) {
    const filterStr = Object.entries(s.filters).map(([k, v]) => `${k}=${v}`).join(', ');
    lines.push(`Filters: ${filterStr}`);
  }

  if (s.highlights.length > 0) {
    lines.push('Highlights:');
    for (const h of s.highlights.slice(0, MAX_HIGHLIGHTS)) lines.push(`- ${h.label}: ${h.value}`);
  }

  if (s.sections && s.sections.length > 0) {
    lines.push('Sections on screen (call the referenced tool to load full or updated data):');
    for (const sec of s.sections.slice(0, MAX_SECTIONS)) {
      const summary = truncate(sec.summary, MAX_SUMMARY_LEN);
      let hint = '';
      if (sec.detail) {
        const args = sec.detail.args && Object.keys(sec.detail.args).length > 0
          ? ` ${JSON.stringify(sec.detail.args)}`
          : '';
        hint = ` [details: ${sec.detail.tool}${args}]`;
      }
      lines.push(`- ${sec.title}: ${summary}${hint}`);
    }
  }

  return lines.join('\n');
}
