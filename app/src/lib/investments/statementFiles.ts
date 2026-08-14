/**
 * True if a filename should be imported by the statement backfill: a `.pdf`
 * that is NOT a 529 college-savings statement and NOT the redundant annual
 * report. Both exclusions are anchored on separators/end so they don't
 * false-positive on an in-name date fragment like "0529".
 *
 * The `529s?` matches both the bare "529" token and the actual filenames,
 * which are pluralized "529s" (e.g. "2025-03 VG Statement 529s.pdf").
 */
export function isStatementFile(name: string): boolean {
  return /\.pdf$/i.test(name)
    && !/(^|[-_ ])529s?([-_ .]|$)/i.test(name)
    && !/annual[-_ ]?report/i.test(name);
}
