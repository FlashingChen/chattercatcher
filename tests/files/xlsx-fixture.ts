import { Buffer } from "node:buffer";
import yazl from "yazl";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function addText(zip: yazl.ZipFile, filePath: string, text: string): void {
  zip.addBuffer(Buffer.from(text, "utf8"), filePath);
}

export interface XlsxFixtureSheet {
  name: string;
  rows: string[][];
}

function columnLetter(index: number): string {
  let value = "";
  let n = index;
  while (n >= 0) {
    value = String.fromCharCode((n % 26) + 65) + value;
    n = Math.floor(n / 26) - 1;
  }
  return value;
}

/**
 * 在内存里拼一个最小可用的 xlsx（OOXML zip），单元格统一使用 sharedStrings，
 * 便于测试解析器对「每个工作表的单元格文本」的覆盖。
 */
export async function createXlsxBuffer(sheets: XlsxFixtureSheet[]): Promise<Buffer> {
  const zip = new yazl.ZipFile();

  const sharedStrings: string[] = [];
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      for (const cell of row) {
        if (!sharedStrings.includes(cell)) {
          sharedStrings.push(cell);
        }
      }
    }
  }
  const stringIndex = new Map<string, number>(
    sharedStrings.map((value, index) => [value, index]),
  );

  const sheetOverrides = sheets
    .map(
      (sheet, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("\n  ");

  addText(
    zip,
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${sheetOverrides}
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`,
  );
  addText(
    zip,
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  );
  addText(
    zip,
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${sheets.map((sheet, i) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("\n    ")}
  </sheets>
</workbook>`,
  );
  addText(
    zip,
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n  ")}
</Relationships>`,
  );
  addText(
    zip,
    "xl/sharedStrings.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">
  ${sharedStrings.map((value) => `<si><t>${escapeXml(value)}</t></si>`).join("\n  ")}
</sst>`,
  );

  sheets.forEach((sheet, sheetIndex) => {
    const rowsXml = sheet.rows
      .map((row, rowIndex) => {
        const cellsXml = row
          .map((cell, cellIndex) => {
            const ref = `${columnLetter(cellIndex)}${rowIndex + 1}`;
            return `<c r="${ref}" t="s"><v>${stringIndex.get(cell)}</v></c>`;
          })
          .join("");
        return `<row r="${rowIndex + 1}">${cellsXml}</row>`;
      })
      .join("\n      ");
    addText(
      zip,
      `xl/worksheets/sheet${sheetIndex + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
      ${rowsXml}
  </sheetData>
</worksheet>`,
    );
  });

  zip.end();

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("error", reject);
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}
