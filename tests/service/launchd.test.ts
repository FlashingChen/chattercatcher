import { describe, expect, it } from "vitest";
import { buildLaunchdPlist, GATEWAY_SERVICE_LABEL, LAUNCHD_PLIST_NAME, getLaunchdPlistPath } from "../../src/service/launchd.js";

const spec = {
  nodePath: "/usr/local/bin/node",
  cliEntry: "/opt/chattercatcher/dist/cli.js",
  logFile: "/Users/tester/.chattercatcher/logs/gateway.log",
  homeDir: "/Users/tester",
  chatterCatcherHome: "/Users/tester/.chattercatcher",
};

describe("launchd plist 生成", () => {
  it("plist 包含 Label、node+dist/cli.js 参数与 KeepAlive", () => {
    const plist = buildLaunchdPlist(spec);

    expect(plist).toContain(`<string>${GATEWAY_SERVICE_LABEL}</string>`);
    expect(plist).toContain("<key>ProgramArguments</key>");
    expect(plist).toContain(`<string>${spec.nodePath}</string>`);
    expect(plist).toContain(`<string>${spec.cliEntry}</string>`);
    expect(plist).toContain("<string>gateway</string>");
    expect(plist).toContain("<string>start</string>");
    expect(plist).toContain("<string>--foreground</string>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("<true/>");
    expect(plist).toContain("<key>RunAtLoad</key>");
  });

  it("plist 日志路径指向 logs/gateway.log，且写入 CHATTERCATCHER_HOME 环境变量", () => {
    const plist = buildLaunchdPlist(spec);

    expect(plist).toContain(`<string>${spec.logFile}</string>`);
    expect(plist).toContain("<key>StandardOutPath</key>");
    expect(plist).toContain("<key>StandardErrorPath</key>");
    expect(plist).toContain(`<key>CHATTERCATCHER_HOME</key>`);
    expect(plist).toContain(`<string>${spec.chatterCatcherHome}</string>`);
  });

  it("plist 路径定位到 ~/Library/LaunchAgents", () => {
    expect(getLaunchdPlistPath("/Users/tester")).toBe(
      `/Users/tester/Library/LaunchAgents/${LAUNCHD_PLIST_NAME}`,
    );
  });
});
