import PDFDocument from 'pdfkit';

/** A column in a CSV or PDF export. */
export interface Column<T extends object> {
  key: keyof T & string;
  label: string;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

/**
 * RFC 4180 CSV. Fields containing a comma, quote or newline are quoted and
 * inner quotes doubled. The UTF-8 BOM is what makes Excel show `Sin categoría`
 * instead of `Sin categorÃ­a`.
 */
export function toCsv<T extends object>(
  columns: readonly Column<T>[],
  rows: readonly T[],
): string {
  const escape = (value: unknown): string => {
    const text = cell(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [
    columns.map((column) => escape(column.label)).join(','),
    ...rows.map((row) => columns.map((column) => escape(row[column.key])).join(',')),
  ];

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

const ROW_HEIGHT = 16;
const PAGE_MARGIN = 40;

/**
 * A plain table PDF: title, generation time, header row and the data.
 *
 * Deliberately not a layout engine. Reports are printed or attached to an
 * email; one readable table with page breaks is the whole requirement, and a
 * dependency that draws charts would be a second product to maintain.
 */
export function toPdf<T extends object>(
  title: string,
  columns: readonly Column<T>[],
  rows: readonly T[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
    const chunks: Buffer[] = [];

    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    document.fontSize(16).fillColor('#111111').text(title);
    document
      .fontSize(9)
      .fillColor('#666666')
      .text(`Generado: ${new Date().toISOString()}`);
    document.moveDown(1);

    if (rows.length === 0) {
      document.fontSize(10).fillColor('#333333').text('Sin datos para el rango solicitado.');
      document.end();
      return;
    }

    const width =
      document.page.width - document.page.margins.left - document.page.margins.right;
    const columnWidth = width / columns.length;

    const drawHeader = (): void => {
      const top = document.y;
      document.rect(document.page.margins.left, top, width, ROW_HEIGHT).fill('#eeeeee');
      document.fillColor('#111111').fontSize(8);
      columns.forEach((column, index) => {
        document.text(column.label, document.page.margins.left + index * columnWidth + 3, top + 4, {
          width: columnWidth - 6,
          ellipsis: true,
        });
      });
      document.y = top + ROW_HEIGHT;
    };

    drawHeader();

    for (const row of rows) {
      if (document.y + ROW_HEIGHT > document.page.height - document.page.margins.bottom) {
        document.addPage();
        document.y = document.page.margins.top;
        drawHeader();
      }

      const top = document.y;
      document.fillColor('#333333').fontSize(8);
      columns.forEach((column, index) => {
        document.text(cell(row[column.key]), document.page.margins.left + index * columnWidth + 3, top + 4, {
          width: columnWidth - 6,
          ellipsis: true,
        });
      });
      document.y = top + ROW_HEIGHT;
      document
        .moveTo(document.page.margins.left, document.y)
        .lineTo(document.page.margins.left + width, document.y)
        .strokeColor('#e0e0e0')
        .lineWidth(0.5)
        .stroke();
    }

    document.end();
  });
}
