// KID-2478: a tiny .xlsx writer for the two bulk-upload templates.
//
// The templates are small and fixed: one worksheet, an inline-string header
// row, one sample row, optional cell notes and one data-validation range.
// Writing the handful of OpenXML parts directly keeps the Cloudflare Worker
// bundle free of a full spreadsheet library, and the ZIP is stored (method 0)
// so generation needs no compression code at runtime.
//
// The output opens in Excel, LibreOffice and the OpenXML readers used by the
// uploader (lib/xlsx-lite.ts reads the same parts).

export type XlsxColumn = {
  header: string;
  width: number;
  note?: string;
};

export type XlsxSheet = {
  name: string;
  columns: XlsxColumn[];
  sampleRow: string[];
  /** Extra data rows for tests/tools; when set they replace the single sample
   *  row (row 2 onward). */
  dataRows?: string[][];
  /** Adds a list validation on this 0-based column from row 2 to 1000. */
  listValidation?: { column: number; values: string[] };
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnRef(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

type ZipFile = { name: string; data: Buffer };

function zipStore(files: ZipFile[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const dosTime = 0;
  const dosDate = (33 << 9) | (1 << 5) | 1; // 1980-01-01

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const crc = crc32(file.data);
    const size = file.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, file.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + file.data.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuffer, end]);
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
    <font><b val="1"/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
    <font><i val="1"/><color rgb="FF808080"/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/></patternFill></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function inlineCell(ref: string, style: number, value: string): string {
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet, withComments: boolean): string {
  const columns = sheet.columns;
  const last = columnRef(columns.length - 1);
  const dataRows = sheet.dataRows ?? [sheet.sampleRow];
  const cols = columns
    .map((column, index) => `<col width="${column.width}" customWidth="1" min="${index + 1}" max="${index + 1}"/>`)
    .join("");

  const headerRow = columns
    .map((column, index) => inlineCell(`${columnRef(index)}1`, 1, column.header))
    .join("");
  const bodyRows = dataRows
    .map((values, rowIndex) => {
      const style = sheet.dataRows ? 0 : 2;
      const cells = columns
        .map((_column, index) => inlineCell(`${columnRef(index)}${rowIndex + 2}`, style, values[index] ?? ""))
        .join("");
      return `<row r="${rowIndex + 2}">${cells}</row>`;
    })
    .join("");

  const validation = sheet.listValidation
    ? `<dataValidations count="1"><dataValidation sqref="${columnRef(sheet.listValidation.column)}2:${columnRef(sheet.listValidation.column)}1000" showDropDown="0" showInputMessage="0" showErrorMessage="0" allowBlank="1" errorTitle="Invalid role" error="Use one of: ${escapeXml(sheet.listValidation.values.join(", "))}" type="list"><formula1>&quot;${escapeXml(sheet.listValidation.values.join(","))}&quot;</formula1></dataValidation></dataValidations>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetPr><outlinePr summaryBelow="1" summaryRight="1"/></sheetPr>
  <dimension ref="A1:${last}${dataRows.length + 1}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A1" sqref="A1"/></sheetView></sheetViews>
  <sheetFormatPr baseColWidth="8" defaultRowHeight="15"/>
  <cols>${cols}</cols>
  <sheetData><row r="1" ht="30" customHeight="1">${headerRow}</row>${bodyRows}</sheetData>
  ${validation}
  <pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/>
  ${withComments ? `<legacyDrawing r:id="anysvml"/>` : ""}
</worksheet>`;
}

function commentsXml(sheet: XlsxSheet): string {
  const comments = sheet.columns
    .map((column, index) => {
      if (!column.note) return "";
      return `<comment ref="${columnRef(index)}1" authorId="0" shapeId="${index}"><text><t>${escapeXml(column.note)}</t></text></comment>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>Kiddy</author></authors><commentList>${comments}</commentList></comments>`;
}

function commentsVml(sheet: XlsxSheet): string {
  const shapes = sheet.columns
    .map((column, index) => {
      if (!column.note) return "";
      return `<v:shape type="#_x0000_t202" style="position:absolute; margin-left:59.25pt;margin-top:1.5pt;width:144px;height:79px;z-index:1;visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto" id="_x0000_s${1026 + index}"><v:fill color2="#ffffe1"/><v:shadow color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"/></v:textbox><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:AutoFill>False</x:AutoFill><x:Row>0</x:Row><x:Column>${index}</x:Column></x:ClientData></v:shape>`;
    })
    .join("");
  return `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>${shapes}</xml>`;
}

/** Build an .xlsx workbook with one sheet. */
export function writeXlsx(sheet: XlsxSheet): Buffer {
  const hasNotes = sheet.columns.some((column) => Boolean(column.note));
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${hasNotes ? `<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>` : ""}
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${hasNotes ? `<Override PartName="/xl/comments/comment1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>` : ""}
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml" Id="rId1"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <workbookPr/>
  <bookViews><workbookView visibility="visible" minimized="0" showHorizontalScroll="1" showVerticalScroll="1" showSheetTabs="1" tabRatio="600" firstSheet="0" activeTab="0"/></bookViews>
  <sheets><sheet name="${escapeXml(sheet.name)}" sheetId="1" state="visible" r:id="rId1"/></sheets>
  <calcPr calcId="124519" fullCalcOnLoad="1"/>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml" Id="rId1"/>
  <Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml" Id="rId2"/>
</Relationships>`;

  const sheetRels = hasNotes
    ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="/xl/comments/comment1.xml" Id="comments"/>
  <Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="/xl/drawings/commentsDrawing1.vml" Id="anysvml"/>
</Relationships>`
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

  const files: ZipFile[] = [
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes) },
    { name: "_rels/.rels", data: Buffer.from(rootRels) },
    { name: "xl/workbook.xml", data: Buffer.from(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRels) },
    { name: "xl/styles.xml", data: Buffer.from(stylesXml()) },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheetXml(sheet, hasNotes)) },
    { name: "xl/worksheets/_rels/sheet1.xml.rels", data: Buffer.from(sheetRels) },
  ];
  if (hasNotes) {
    files.push({ name: "xl/comments/comment1.xml", data: Buffer.from(commentsXml(sheet)) });
    files.push({ name: "xl/drawings/commentsDrawing1.vml", data: Buffer.from(commentsVml(sheet)) });
  }
  return zipStore(files);
}
