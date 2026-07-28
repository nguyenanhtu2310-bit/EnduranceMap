import { describe, expect, it } from 'vitest';
import { buildXlsxBytes, type Sheet } from '../xlsx';

/** Entries are stored uncompressed, so the parts are readable straight out of the bytes. */
function archiveText(sheets: Sheet[]): string {
  return new TextDecoder().decode(buildXlsxBytes(sheets));
}

describe('buildXlsxBytes', () => {
  const simple: Sheet[] = [{ name: 'One', rows: [['Station', 'Open'], ['CP1', '05:30']] }];

  it('writes something a reader will recognise as a zip', () => {
    const bytes = buildXlsxBytes(simple);
    // Local file header, then the end-of-central-directory record at the tail.
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const tail = bytes.slice(-22);
    expect([tail[0], tail[1], tail[2], tail[3]]).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });

  it('includes every part a workbook needs', () => {
    const text = archiveText(simple);
    for (const part of [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ]) {
      expect(text).toContain(part);
    }
  });

  it('writes one worksheet part per sheet', () => {
    const text = archiveText([
      { name: 'A', rows: [['x']] },
      { name: 'B', rows: [['y']] },
      { name: 'C', rows: [['z']] },
    ]);
    expect(text).toContain('xl/worksheets/sheet3.xml');
    expect(text).not.toContain('xl/worksheets/sheet4.xml');
  });

  it('keeps numbers as numbers so they stay summable', () => {
    const text = archiveText([{ name: 'N', rows: [['Peak'], [688]] }]);
    // A numeric cell carries <v>, not an inline string.
    expect(text).toContain('<v>688</v>');
    expect(text).not.toContain('<t xml:space="preserve">688</t>');
  });

  it('escapes what would otherwise break the XML', () => {
    const text = archiveText([{ name: 'E', rows: [['Split & <turn>']] }]);
    expect(text).toContain('Split &amp; &lt;turn&gt;');
  });

  it('strips control characters, which turn a workbook into a repair prompt', () => {
    const text = archiveText([{ name: 'C', rows: [['badvalue']] }]);
    expect(text).toContain('badvalue');
  });

  it('carries text that is not ASCII', () => {
    // The bytes are UTF-8, so decoding them back gives the original.
    expect(archiveText([{ name: 'V', rows: [['Trạm nước']] }])).toContain('Trạm nước');
  });

  it('leaves an empty cell out rather than writing a blank', () => {
    const text = archiveText([{ name: 'G', rows: [['a', null, 'c']] }]);
    expect(text).toContain('r="A1"');
    expect(text).toContain('r="C1"');
    expect(text).not.toContain('r="B1"');
  });

  it('numbers columns past Z the way a spreadsheet does', () => {
    const wide = Array.from({ length: 28 }, (_, i) => `c${i}`);
    const text = archiveText([{ name: 'W', rows: [wide] }]);
    expect(text).toContain('r="Z1"');
    expect(text).toContain('r="AA1"');
    expect(text).toContain('r="AB1"');
  });

  it('freezes the header row', () => {
    expect(archiveText(simple)).toContain('state="frozen"');
  });
});

describe('sheet names', () => {
  it('drops the characters a spreadsheet refuses in a tab name', () => {
    const text = archiveText([{ name: 'Splits [21K]: 1/2', rows: [['x']] }]);
    expect(text).toContain('name="Splits  21K   1 2"');
  });

  it('trims to the length a tab allows', () => {
    const text = archiveText([{ name: 'x'.repeat(40), rows: [['x']] }]);
    expect(text).toContain(`name="${'x'.repeat(31)}"`);
    expect(text).not.toContain('x'.repeat(32));
  });

  it('makes duplicate names unique, which a workbook will not open without', () => {
    const text = archiveText([
      { name: 'Splits', rows: [['a']] },
      { name: 'Splits', rows: [['b']] },
      { name: 'Splits', rows: [['c']] },
    ]);
    expect(text).toContain('name="Splits"');
    expect(text).toContain('name="Splits 2"');
    expect(text).toContain('name="Splits 3"');
  });

  it('gives an unnamed sheet something to be called', () => {
    expect(archiveText([{ name: '', rows: [['a']] }])).toContain('name="Sheet 1"');
  });

  it('still produces a workbook when there is nothing to write', () => {
    const bytes = buildXlsxBytes([]);
    expect(bytes.length).toBeGreaterThan(0);
    expect(new TextDecoder().decode(bytes)).toContain('xl/worksheets/sheet1.xml');
  });
});
