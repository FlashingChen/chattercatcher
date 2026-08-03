import fs from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import JSZip from "jszip";
import * as cheerio from "cheerio";

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".json", ".csv", ".tsv", ".log"]);
const DOCX_EXTENSIONS = new Set([".docx"]);
const PDF_EXTENSIONS = new Set([".pdf"]);
const XLSX_EXTENSIONS = new Set([".xlsx"]);
const PPTX_EXTENSIONS = new Set([".pptx"]);
const HTML_EXTENSIONS = new Set([".html", ".htm"]);

export interface ParsedFile {
  text: string;
  parser: "text" | "docx" | "pdf" | "xlsx" | "pptx" | "html";
  warnings: string[];
}

export function isSupportedParseFile(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return (
    TEXT_EXTENSIONS.has(extension) ||
    DOCX_EXTENSIONS.has(extension) ||
    PDF_EXTENSIONS.has(extension) ||
    XLSX_EXTENSIONS.has(extension) ||
    PPTX_EXTENSIONS.has(extension) ||
    HTML_EXTENSIONS.has(extension)
  );
}

export function describeSupportedParseTypes(): string {
  return "txt、md、json、csv、tsv、log、docx、pdf、xlsx、pptx、html";
}

async function parseXlsxToText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);

  // 共享字符串表（Excel 常见的中文文本都收在这里）
  const sharedStrings: string[] = [];
  const sharedEntry = zip.file("xl/sharedStrings.xml");
  if (sharedEntry) {
    const xml = await sharedEntry.async("string");
    const $ = cheerio.load(xml, { xml: true });
    $("si").each((_, el) => {
      sharedStrings.push($(el).find("t").text());
    });
  }

  const sheetNames = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/sheet(\d+)\.xml$/)![1], 10);
      const nb = parseInt(b.match(/sheet(\d+)\.xml$/)![1], 10);
      return na - nb;
    });

  const blocks: string[] = [];
  for (const name of sheetNames) {
    const xml = await zip.file(name)!.async("string");
    const $ = cheerio.load(xml, { xml: true });
    const rows: string[] = [];
    $("row").each((_, row) => {
      const cells: string[] = [];
      $(row)
        .children("c")
        .each((_, cell) => {
          const type = $(cell).attr("t");
          const value = $(cell).find("v").first().text();
          if (type === "s") {
            const idx = parseInt(value, 10);
            if (sharedStrings[idx]) cells.push(sharedStrings[idx]);
          } else if (type === "inlineStr") {
            const inlineText = $(cell).find("is").find("t").text();
            if (inlineText) cells.push(inlineText);
          } else if (type === "b") {
            cells.push(value === "1" ? "TRUE" : value === "0" ? "FALSE" : value);
          } else if (type !== "e" && value) {
            // 数值、日期序列号、公式字符串结果等直接取 <v> 文本
            cells.push(value);
          }
        });
      if (cells.length) rows.push(cells.join(" "));
    });
    if (rows.length) blocks.push(rows.join("\n"));
  }
  return blocks.join("\n\n");
}

async function parsePptxToText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);

  // 幻灯片文字在 ppt/slides/slideN.xml 的 <a:t> 标签里，按 slide 序号排序保证顺序
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)\.xml$/)![1], 10);
      const nb = parseInt(b.match(/slide(\d+)\.xml$/)![1], 10);
      return na - nb;
    });

  const slides: string[] = [];
  for (const name of slideNames) {
    const xml = await zip.file(name)!.async("string");
    const $ = cheerio.load(xml, { xml: true });
    const texts: string[] = [];
    $("*").each((_, el) => {
      // $("*") 只会产出元素节点，Document/Text 等不会有 name
      const tagName = (el as { name?: string }).name ?? "";
      if (tagName === "t" || tagName.endsWith(":t")) {
        texts.push($(el).text());
      }
    });
    if (texts.length) slides.push(texts.join("\n"));
  }
  return slides.join("\n\n---\n\n");
}

async function parseHtmlToText(html: string): Promise<string> {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, head, iframe, svg, template").remove();
  const text = $("body").length ? $("body").text() : $.root().text();
  return text.replace(/\s+/g, " ").trim();
}

export async function parseFileToText(filePath: string): Promise<ParsedFile> {
  const extension = path.extname(filePath).toLowerCase();

  if (TEXT_EXTENSIONS.has(extension)) {
    return {
      text: await fs.readFile(filePath, "utf8"),
      parser: "text",
      warnings: [],
    };
  }

  if (DOCX_EXTENSIONS.has(extension)) {
    const result = await mammoth.extractRawText({ path: filePath });
    return {
      text: result.value,
      parser: "docx",
      warnings: result.messages.map((message) => message.message),
    };
  }

  if (PDF_EXTENSIONS.has(extension)) {
    const buffer = await fs.readFile(filePath);
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return {
        text: result.text,
        parser: "pdf",
        warnings: [],
      };
    } finally {
      await parser.destroy();
    }
  }

  if (XLSX_EXTENSIONS.has(extension)) {
    const buffer = await fs.readFile(filePath);
    return {
      text: await parseXlsxToText(buffer),
      parser: "xlsx",
      warnings: [],
    };
  }

  if (PPTX_EXTENSIONS.has(extension)) {
    const buffer = await fs.readFile(filePath);
    return {
      text: await parsePptxToText(buffer),
      parser: "pptx",
      warnings: [],
    };
  }

  if (HTML_EXTENSIONS.has(extension)) {
    return {
      text: await parseHtmlToText(await fs.readFile(filePath, "utf8")),
      parser: "html",
      warnings: [],
    };
  }

  throw new Error(`暂不支持该文件类型：${extension || "无扩展名"}。当前支持 ${describeSupportedParseTypes()}。`);
}
