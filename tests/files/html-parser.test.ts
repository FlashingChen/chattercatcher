import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFileToText, isSupportedParseFile } from "../../src/files/parser.js";

let testDir: string;

const HTML_FIXTURE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>端午活动</title>
  <script>
    const secret = "脚本内容不该出现";
    console.log("debug 内容");
  </script>
  <style>
    body { color: red; }
  </style>
</head>
<body>
  <nav>
    <ul>
      <li><a href="/home">首页</a></li>
      <li><a href="/about">关于我们</a></li>
    </ul>
  </nav>
  <main>
    <h1>端午活动改到 2026/6/30</h1>
    <p>记得带粽子回老家，晚上一起吃粽子。</p>
  </main>
</body>
</html>`;

describe("html file parser", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-parser-html-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("支持 html / htm 扩展名", () => {
    expect(isSupportedParseFile("a.html")).toBe(true);
    expect(isSupportedParseFile("a.htm")).toBe(true);
  });

  it("提取正文并剥掉 script/style/nav 样板", async () => {
    const sourcePath = path.join(testDir, "family.html");
    await fs.writeFile(sourcePath, HTML_FIXTURE, "utf8");

    const parsed = await parseFileToText(sourcePath);

    expect(parsed.parser).toBe("html");
    expect(parsed.warnings).toEqual([]);
    // 正文中文在
    expect(parsed.text).toContain("端午活动改到 2026/6/30");
    expect(parsed.text).toContain("记得带粽子回老家");
    // 脚本内容不在
    expect(parsed.text).not.toContain("脚本内容不该出现");
    expect(parsed.text).not.toContain("console.log");
    // 导航样板不在
    expect(parsed.text).not.toContain("首页");
    expect(parsed.text).not.toContain("关于我们");
  });
});
