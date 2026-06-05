import { toCsv, type CsvColumn } from "@/shared/lib/csv/toCsv";

/**
 * rows → CSV Blob 다운로드(브라우저 네이티브 API만).
 * UTF-8 BOM prepend(엑셀 한글 깨짐 방지) + objectURL revoke(메모리 누수 차단).
 */
export function downloadCsv<T>(
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
  filename: string
): void {
  const csv = toCsv(rows, columns);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
