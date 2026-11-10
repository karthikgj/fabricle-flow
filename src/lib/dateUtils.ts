/**
 * Shared date display helpers for Fabricle Flow.
 * Keep date-only values as YYYY-MM-DD in Supabase and form state;
 * convert only at the presentation layer.
 */

export function formatDate(
  value: string | Date | null | undefined,
  fallback = "—",
): string {
  if (value === null || value === undefined || value === "") return fallback;

  // Date-only database values must not pass through timezone conversion.
  if (typeof value === "string") {
    const match = value.match(/^(\\d{4})-(\\d{2})-(\\d{2})/);
    if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${date.getFullYear()}`;
}

export function formatDateTime(
  value: string | Date | null | undefined,
  fallback = "—",
): string {
  if (value === null || value === undefined || value === "") return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  const datePart = formatDate(date, fallback);
  const timePart = date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  return `${datePart}, ${timePart}`;
}
