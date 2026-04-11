/**
 * SQLite timestamp helpers.
 *
 * SQLite's `datetime('now')` returns a naive wall-clock UTC string like
 * `"2026-04-11 23:29:00"` — no timezone suffix. When the renderer hands that
 * to `new Date(str)`, Chrome/V8 parses it as *local* time, not UTC, producing
 * an elapsed reading equal to the local timezone offset (e.g. every card
 * stuck at "2h" in UTC+2). To avoid that trap:
 *
 * - **Writes:** use {@link ISO_NOW_SQL} instead of `datetime('now')`. It
 *   stores an explicit ISO-8601 UTC string ending in `Z`, which JavaScript
 *   parses correctly anywhere.
 * - **Reads:** pipe stored strings through {@link toIsoUtc} in the mapper.
 *   It's a no-op for already-tagged strings and retrofits a `Z` onto older
 *   rows stored with the naive format, so legacy data displays correctly
 *   without a schema migration.
 */

/**
 * SQL fragment that produces an ISO-8601 UTC timestamp with millisecond
 * precision and an explicit `Z` suffix, e.g. `"2026-04-11T23:29:00.000Z"`.
 * Use in UPDATE/INSERT statements and schema DEFAULTs in place of
 * `datetime('now')`.
 */
export const ISO_NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

const HAS_TZ = /[Zz]$|[+-]\d{2}:?\d{2}$/;

/**
 * Normalize a SQLite timestamp string to an ISO-8601 UTC string that
 * JavaScript's `Date` constructor will interpret as UTC. Handles three
 * input shapes:
 *
 * - `null`/`undefined` → `null`
 * - Already ISO with a `Z` or numeric offset → returned as-is
 * - Naive `"YYYY-MM-DD HH:MM:SS[.fff]"` (SQLite's `datetime('now')` output)
 *   → `"YYYY-MM-DDTHH:MM:SS[.fff]Z"`
 */
export function toIsoUtc(value: string | null | undefined): string | null {
  if (!value) return null;
  if (HAS_TZ.test(value)) return value;
  return `${value.replace(' ', 'T')}Z`;
}
