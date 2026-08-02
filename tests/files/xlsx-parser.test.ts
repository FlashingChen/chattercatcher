import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFileToText, isSupportedParseFile } from "../../src/files/parser.js";
import { createXlsxBuffer } from "./xlsx-fixture.js";

let testDir: string;

describe("xlsx file parser", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-parser-xlsx-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("支持 xlsx 扩展名", () => {
    expect(isSupportedParseFile("a.xlsx")).toBe(true);
  });

  it("解析含中文单元格的多工作表 XLSX 文件", async () => {
    const sourcePath = path.join(testDir, "activity.xlsx");
    await fs.writeFile(
      sourcePath,
      await createXlsxBuffer([
        {
          name: "活动安排",
          rows: [
            ["时间", "事项"],
            ["2026/6/30", "端午活动改到 2026/6/30"],
          ],
        },
        {
          name: "采购清单",
          rows: [["物品", "数量"], ["粽子", "20"], ["咸鸭蛋", "10"]],
        },
      ]),
    );

    const parsed = await parseFileToText(sourcePath);

    expect(parsed.parser).toBe("xlsx");
    expect(parsed.warnings).toEqual([]);
    // 中文不乱码，正文不丢
    expect(parsed.text).toContain("端午活动改到 2026/6/30");
    expect(parsed.text).toContain("粽子");
    expect(parsed.text).toContain("咸鸭蛋");
    // 每个工作表的单元格文本都在（表 1 与表 2 各自的内容都出现）
    expect(parsed.text).toContain("时间");
    expect(parsed.text).toContain("事项");
    expect(parsed.text).toContain("物品");
    expect(parsed.text).toContain("数量");
  });

  it("单个工作表也能解析出全部单元格文本", async () => {
    const sourcePath = path.join(testDir, "single.xlsx");
    await fs.writeFile(
      sourcePath,
      await createXlsxBuffer([
        {
          name: "备注",
          rows: [["标题", "说明"], ["端午", "带粽子回老家"]],
        },
      ]),
    );

    const parsed = await parseFileToText(sourcePath);

    expect(parsed.parser).toBe("xlsx");
    expect(parsed.text).toContain("带粽子回老家");
    expect(parsed.text).toContain("说明");
  });
});
