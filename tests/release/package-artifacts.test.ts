import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "../..");

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
    version: string;
    files?: string[];
    scripts?: Record<string, string>;
  };
}

describe("release package artifacts", () => {
  it("发布前会重新构建 dist", () => {
    const packageJson = readPackageJson();
    expect(packageJson.scripts?.prepack).toBe("npm run build");
  });

  it("构建后的 CLI 版本与 package.json 一致", () => {
    const packageJson = readPackageJson();
    const output = execFileSync(process.execPath, [path.join(projectRoot, "dist/cli.js"), "--version"], {
      encoding: "utf8",
    }).trim();

    expect(output).toBe(packageJson.version);
  });

  it("发布包包含 CHANGELOG.md", () => {
    const packageJson = readPackageJson();
    expect(packageJson.files).toBeDefined();
    expect(packageJson.files).toContain("CHANGELOG.md");
  });

  it("CHANGELOG.md 文件存在且非空", () => {
    const changelogPath = path.join(projectRoot, "CHANGELOG.md");
    expect(fs.existsSync(changelogPath), "CHANGELOG.md file must exist").toBe(true);
    const content = fs.readFileSync(changelogPath, "utf8");
    expect(content.trim().length, "CHANGELOG.md must not be empty").toBeGreaterThan(0);
  });
});
