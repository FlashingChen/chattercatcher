import { describe, expect, it } from "vitest";
import { buildSystemdUnit, getSystemdUnitPath, SYSTEMD_UNIT_NAME } from "../../src/service/systemd.js";

const spec = {
  cliEntry: "/opt/chattercatcher/dist/cli.js",
  workingDirectory: "/opt/chattercatcher/dist",
  logFile: "/home/tester/.chattercatcher/logs/gateway.log",
  homeDir: "/home/tester",
  chatterCatcherHome: "/home/tester/.chattercatcher",
};

describe("systemd unit 生成", () => {
  it("unit 包含 ExecStart、Restart 与 WorkingDirectory", () => {
    const unit = buildSystemdUnit(spec);

    expect(unit).toContain(`[Unit]`);
    expect(unit).toContain("Description=ChatterCatcher Gateway");
    expect(unit).toContain("ExecStart=/usr/bin/env node /opt/chattercatcher/dist/cli.js gateway start --foreground");
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain(`WorkingDirectory=${spec.workingDirectory}`);
  });

  it("unit 写入日志路径与 CHATTERCATCHER_HOME 环境变量", () => {
    const unit = buildSystemdUnit(spec);

    expect(unit).toContain(`Environment=CHATTERCATCHER_HOME=${spec.chatterCatcherHome}`);
    expect(unit).toContain(`StandardOutput=append:${spec.logFile}`);
    expect(unit).toContain(`StandardError=append:${spec.logFile}`);
  });

  it("unit 路径定位到 ~/.config/systemd/user", () => {
    expect(getSystemdUnitPath("/home/tester")).toBe(
      `/home/tester/.config/systemd/user/${SYSTEMD_UNIT_NAME}`,
    );
  });
});
