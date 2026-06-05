export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

function escapeCell(
  raw: string | number | null | undefined
): string {
  if (raw == null) return "";
  const s = String(raw);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(
  rows: readonly T[],
  columns: readonly CsvColumn<T>[]
): string {
  const header = columns.map((c) => escapeCell(c.header)).join(",");
  const body = rows.map((row) =>
    columns.map((c) => escapeCell(c.value(row))).join(",")
  );
  return [header, ...body].join("\r\n");
}
