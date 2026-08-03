import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SYSTEMD_UNIT_NAME = "chattercatcher-gateway.service";

export interface SystemdSpec {
  cliEntry: string;
  workingDirectory: string;
  logFile: string;
  homeDir: string;
  chatterCatcherHome: string;
}

export interface SystemdServiceState {
  installed: boolean;
  running: boolean | null;
}

export interface InstallSystemdResult {
  unitPath: string;
  message: string;
}

export function getSystemdUnitPath(homeDir = os.homedir()): string {
  return path.join(homeDir, ".config", "systemd", "user", SYSTEMD_UNIT_NAME);
}

export function buildSystemdUnit(spec: SystemdSpec): string {
  const execStart = `/usr/bin/env node ${spec.cliEntry} gateway start --foreground`;
  return `[Unit]
Description=ChatterCatcher Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${execStart}
Restart=on-failure
WorkingDirectory=${spec.workingDirectory}
Environment=CHATTERCATCHER_HOME=${spec.chatterCatcherHome}
StandardOutput=append:${spec.logFile}
StandardError=append:${spec.logFile}

[Install]
WantedBy=default.target
`;
}

export function installSystemdService(spec: SystemdSpec): InstallSystemdResult {
  const unitPath = getSystemdUnitPath(spec.homeDir);
  fs.mkdirSync(path.dirname(unitPath), { recursive: true });
  fs.writeFileSync(unitPath, buildSystemdUnit(spec), "utf8");
  return {
    unitPath,
    message: `已生成 systemd 用户服务（未真机验证）：${unitPath}\n` +
      `启用开机自启：systemctl --user daemon-reload && systemctl --user enable --now ${SYSTEMD_UNIT_NAME}`,
  };
}

export function getSystemdServiceState(homeDir = os.homedir()): SystemdServiceState {
  const unitPath = getSystemdUnitPath(homeDir);
  const installed = fs.existsSync(unitPath);

  let running: boolean | null = null;
  const result = spawnSync("systemctl", ["--user", "is-active", SYSTEMD_UNIT_NAME.replace(/\.service$/, "")], {
    encoding: "utf8",
  });
  if (result.status === 0) {
    running = result.stdout.trim() === "active";
  }

  return { installed, running };
}

export function uninstallSystemdService(homeDir = os.homedir()): { message: string } {
  const unitPath = getSystemdUnitPath(homeDir);
  let removed = false;
  try {
    fs.rmSync(unitPath, { force: true });
    removed = true;
  } catch {
    // 删除失败则保留，如实报告。
  }

  return {
    message:
      (removed ? `已删除 systemd 服务文件：${unitPath}` : `systemd 服务文件删除失败：${unitPath}`) +
      `\n如需停止并移除运行实例：systemctl --user disable --now ${SYSTEMD_UNIT_NAME.replace(/\.service$/, "")}`,
  };
}
