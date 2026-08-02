import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFileToText, isSupportedParseFile } from "../../src/files/parser.js";
import { createPptxBuffer } from "./pptx-fixture.js";

let testDir: string;

describe("pptx file parser", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-parser-pptx-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("支持 pptx 扩展名", () => {
    expect(isSupportedParseFile("a.pptx")).toBe(true);
  });

  it("按幻灯片顺序解析出每一页的文字", async () => {
    const sourcePath = path.join(testDir, "family.pptx");
    await fs.writeFile(
      sourcePath,
      await createPptxBuffer([
        ["端午家庭活动", "第一页：活动安排"],
        ["采购清单", "第二页：记得带粽子"],
      ]),
    );

    const parsed = await parseFileToText(sourcePath);

    expect(parsed.parser).toBe("pptx");
    expect(parsed.warnings).toEqual([]);
    // 中文不乱码、正文不丢
    expect(parsed.text).toContain("端午家庭活动");
    expect(parsed.text).toContain("记得带粽子");
    // 两页以上内容都在且顺序对（第一页在前，第二页在后）
    const firstIndex = parsed.text.indexOf("第一页");
    const secondIndex = parsed.text.indexOf("第二页");
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeGreaterThan(firstIndex);
  });

  it("单页多段文本也能全部提取", async () => {
    const sourcePath = path.join(testDir, "single.pptx");
    await fs.writeFile(
      sourcePath,
      await createPptxBuffer([["标题", "正文一", "正文二"]]),
    );

    const parsed = await parseFileToText(sourcePath);

    expect(parsed.parser).toBe("pptx");
    expect(parsed.text).toContain("标题");
    expect(parsed.text).toContain("正文一");
    expect(parsed.text).toContain("正文二");
  });
});
