import { describe, expect, it } from 'vitest';
import { toCsv, toPdf, type Column } from './report-format.js';

interface Row {
  category: string;
  total: number;
}

const COLUMNS: readonly Column<Row>[] = [
  { key: 'category', label: 'Categoría' },
  { key: 'total', label: 'Total' },
];

describe('toCsv', () => {
  it('writes a BOM, a header and CRLF rows', () => {
    const csv = toCsv(COLUMNS, [{ category: 'Ventas', total: 12.5 }]);

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toBe('\uFEFFCategoría,Total\r\nVentas,12.5\r\n');
  });

  it('quotes commas, quotes and newlines', () => {
    const csv = toCsv(COLUMNS, [
      { category: 'Insumos, limpieza', total: 1 },
      { category: 'Dijo "hola"', total: 2 },
      { category: 'dos\nlíneas', total: 3 },
    ]);

    expect(csv).toContain('"Insumos, limpieza",1');
    expect(csv).toContain('"Dijo ""hola""",2');
    expect(csv).toContain('"dos\nlíneas",3');
  });

  it('writes only the header when there are no rows', () => {
    expect(toCsv(COLUMNS, [])).toBe('\uFEFFCategoría,Total\r\n');
  });
});

describe('toPdf', () => {
  it('produces a PDF document', async () => {
    const buffer = await toPdf('Reporte de ventas', COLUMNS, [
      { category: 'Ventas', total: 1200 },
    ]);

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it('still produces a document with no rows', async () => {
    const buffer = await toPdf('Reporte de ventas', COLUMNS, []);

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
