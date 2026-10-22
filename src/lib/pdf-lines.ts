export type PdfTextItem = { str?: string; transform?: number[] };

export function itemsToLines(items: PdfTextItem[]): string {
  const rows: Array<{ y: number; cells: Array<{ x: number; str: string }> }> = [];

  for (const item of items) {
    if (!item.str || !item.str.trim() || !item.transform) continue;

    const x = item.transform[4];
    const y = item.transform[5];

    let row = rows.find((r) => Math.abs(r.y - y) <= 3);
    if (!row) {
      row = { y, cells: [] };
      rows.push(row);
    }
    row.cells.push({ x, str: item.str.trim() });
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) =>
      row.cells
        .sort((a, b) => a.x - b.x)
        .map((c) => c.str)
        .join("  ")
    )
    .join("\n");
}