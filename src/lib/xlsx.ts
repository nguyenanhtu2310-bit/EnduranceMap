/**
 * A minimal spreadsheet writer.
 *
 * An .xlsx is a ZIP of XML parts, which is little enough work to write directly. A
 * library would do it in one call and add several hundred kilobytes to a bundle that is
 * otherwise React and nothing else — the same reason the HTML report is assembled by
 * hand rather than templated.
 *
 * Entries are stored uncompressed. A schedule is a few hundred rows, so the saving from
 * deflate would be invisible and it would mean carrying a compressor.
 */

export type CellValue = string | number | null | undefined;

export interface Sheet {
  /** Tab name. Trimmed to what Excel accepts. */
  name: string;
  /** First row is treated as the header and frozen. */
  rows: CellValue[][];
}

/* ------------------------------------------------------------------ zip ---- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface Entry {
  name: string;
  bytes: Uint8Array;
  crc: number;
  offset: number;
}

/** Packs named byte arrays into a ZIP archive, stored rather than deflated. */
function zip(files: { name: string; text: string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const entries: Entry[] = [];
  let offset = 0;

  const push = (bytes: Uint8Array) => {
    chunks.push(bytes);
    offset += bytes.length;
  };

  const header = (size: number) => {
    const buffer = new ArrayBuffer(size);
    return { view: new DataView(buffer), bytes: new Uint8Array(buffer) };
  };

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const bytes = encoder.encode(file.text);
    const crc = crc32(bytes);
    const start = offset;

    const { view, bytes: local } = header(30);
    view.setUint32(0, 0x04034b50, true); // local file header
    view.setUint16(4, 20, true); // version needed
    view.setUint16(6, 0x0800, true); // UTF-8 names
    view.setUint16(8, 0, true); // stored
    view.setUint32(14, crc, true);
    view.setUint32(18, bytes.length, true);
    view.setUint32(22, bytes.length, true);
    view.setUint16(26, nameBytes.length, true);

    push(local);
    push(nameBytes);
    push(bytes);
    entries.push({ name: file.name, bytes, crc, offset: start });
  }

  const directoryStart = offset;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const { view, bytes: central } = header(46);
    view.setUint32(0, 0x02014b50, true); // central directory header
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.bytes.length, true);
    view.setUint32(24, entry.bytes.length, true);
    view.setUint16(28, nameBytes.length, true);
    view.setUint32(42, entry.offset, true);

    push(central);
    push(nameBytes);
  }

  const { view, bytes: end } = header(22);
  view.setUint32(0, 0x06054b50, true); // end of central directory
  view.setUint16(8, entries.length, true);
  view.setUint16(10, entries.length, true);
  view.setUint32(12, offset - directoryStart, true);
  view.setUint32(16, directoryStart, true);
  push(end);

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const archive = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    archive.set(chunk, at);
    at += chunk.length;
  }
  return archive;
}

/* ---------------------------------------------------------------- xlsx ---- */

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Control characters are not legal in XML and turn a workbook into a repair prompt.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** A1, B1 … Z1, AA1. */
function ref(columnIndex: number, rowNumber: number): string {
  let n = columnIndex;
  let name = '';
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `${name}${rowNumber}`;
}

/**
 * Excel rejects several characters in a tab name, silently truncates past 31, and will
 * not open a workbook with two tabs alike — so names are cleaned and made unique here
 * rather than trusted from the caller.
 */
function sheetNames(sheets: Sheet[]): string[] {
  const used = new Set<string>();
  return sheets.map((sheet, i) => {
    const cleaned = (sheet.name || `Sheet ${i + 1}`).replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31);
    let name = cleaned || `Sheet ${i + 1}`;
    let suffix = 2;
    while (used.has(name.toLowerCase())) {
      const room = 31 - String(suffix).length - 1;
      name = `${cleaned.slice(0, room)} ${suffix++}`;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

function sheetXml(sheet: Sheet): string {
  const rows = sheet.rows
    .map((cells, r) => {
      const rowNumber = r + 1;
      const body = cells
        .map((value, c) => {
          if (value === null || value === undefined || value === '') return '';
          const at = ref(c, rowNumber);
          if (typeof value === 'number' && Number.isFinite(value)) {
            return `<c r="${at}"><v>${value}</v></c>`;
          }
          // Inline strings, so there is no shared-string table to keep in step.
          return `<c r="${at}" t="inlineStr" s="${r === 0 ? 1 : 0}"><is><t xml:space="preserve">${esc(String(value))}</t></is></c>`;
        })
        .join('');
      return `<row r="${rowNumber}">${body}</row>`;
    })
    .join('');

  const columns = Math.max(1, ...sheet.rows.map((r) => r.length));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="${columns}" width="18" customWidth="1"/></cols><sheetData>${rows}</sheetData></worksheet>`;
}

/**
 * Builds a workbook with one tab per sheet.
 *
 * The header row is frozen and bold, because these are read as reference tables during a
 * race rather than scrolled through once.
 */
export function buildXlsxBytes(sheets: Sheet[]): Uint8Array {
  const usable = sheets.length > 0 ? sheets : [{ name: 'Empty', rows: [] }];
  const names = sheetNames(usable);

  const files = [
    {
      name: '[Content_Types].xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${usable
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
        )
        .join('')}</Types>`,
    },
    {
      name: '_rels/.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
        .map((name, i) => `<sheet name="${esc(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${usable
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
        )
        .join('')}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: 'xl/styles.xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    },
    ...usable.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(sheet) })),
  ];

  return zip(files);
}

/** The workbook as a Blob, ready to hand to the browser. */
export function buildXlsx(sheets: Sheet[]): Blob {
  return new Blob([buildXlsxBytes(sheets) as unknown as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** Hands the workbook to the browser as a download. */
export function downloadXlsx(sheets: Sheet[], fileName: string): void {
  const url = URL.createObjectURL(buildXlsx(sheets));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
