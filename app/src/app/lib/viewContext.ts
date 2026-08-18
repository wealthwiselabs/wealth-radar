export interface ViewSnapshot {
  route: string;
  label: string;
  timeRange?: string;
  filters?: Record<string, string>;
  highlights: { label: string; value: string }[];
  tables?: { title: string; columns: string[]; rows: string[][] }[];
}

let current: ViewSnapshot | null = null;
const listeners = new Set<() => void>();

export function setViewContext(s: ViewSnapshot | null): void {
  current = s;
  for (const fn of listeners) {
    fn();
  }
}

export function getViewContext(): ViewSnapshot | null {
  return current;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const MAX_HIGHLIGHTS = 8;
const MAX_TABLE_ROWS = 15;

export function formatViewContext(s: ViewSnapshot | null): string {
  if (!s) return '';

  const lines: string[] = [];

  lines.push(`The user is viewing ${s.label} (${s.route})`);

  if (s.timeRange) {
    lines.push(`Time range: ${s.timeRange}`);
  }

  if (s.filters && Object.keys(s.filters).length > 0) {
    const filterStr = Object.entries(s.filters)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    lines.push(`Filters: ${filterStr}`);
  }

  if (s.highlights.length > 0) {
    lines.push('Highlights:');
    for (const h of s.highlights.slice(0, MAX_HIGHLIGHTS)) {
      lines.push(`- ${h.label}: ${h.value}`);
    }
  }

  if (s.tables && s.tables.length > 0) {
    for (const t of s.tables) {
      lines.push(t.title);
      lines.push(t.columns.join(' | '));
      for (const row of t.rows.slice(0, MAX_TABLE_ROWS)) {
        lines.push(row.join(' | '));
      }
    }
  }

  return lines.join('\n');
}
