import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const GATEWAY_SERVICE_LABEL = "com.chattercatcher.gateway";
export const LAUNCHD_PLIST_NAME = "com.chattercatcher.gateway.plist";

export interface LaunchdSpec {
  nodePath: string;
  cliEntry: string;
  logFile: string;
  homeDir: string;
  chatterCatcherHome: string;
}

export interface LaunchdServiceState {
  installed: boolean;
  loaded: boolean;
  running: boolean;
  pid?: number;
}

export interface InstallLaunchdResult {
  plistPath: string;
  loaded: boolean;
  message: string;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function getLaunchdPlistPath(homeDir = os.homedir()): string {
  return path.join(homeDir, "Library", "LaunchAgents", LAUNCHD_PLIST_NAME);
}

export function buildLaunchdPlist(spec: LaunchdSpec): string {
  const argumentsXml = [spec.nodePath, spec.cliEntry, "gateway", "start", "--foreground"]
    .map((arg) => `    <string>${escapeXml(arg)}</string>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${GATEWAY_SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argumentsXml}
  </array>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CHATTERCATCHER_HOME</key>
    <string>${escapeXml(spec.chatterCatcherHome)}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${escapeXml(spec.logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(spec.logFile)}</string>
</dict>
</plist>
`;
}

function getGuiDomain(): string {
  const uid = spawnSync("id", ["-u"], { encoding: "utf8" }).stdout.trim();
  return uid ? `gui/${uid}` : "gui/0";
}

export function getLaunchdServiceState(homeDir = os.homedir()): LaunchdServiceState {
  const plistPath = getLaunchdPlistPath(homeDir);
  const installed = fs.existsSync(plistPath);

  let loaded = false;
  let running = false;
  let pid: number | undefined;

  const listResult = spawnSync("launchctl", ["list"], { encoding: "utf8" });
  if (listResult.status === 0) {
    for (const line of listResult.stdout.split("\n")) {
      if (!line.includes(GATEWAY_SERVICE_LABEL)) {
        continue;
      }
      const parts = line.trim().split(/\s+/);
      loaded = true;
      const pidText = parts[0] ?? "-";
      if (pidText !== "-") {
        const parsed = Number(pidText);
        if (Number.isInteger(parsed) && parsed > 0) {
          running = true;
          pid = parsed;
        }
      }
    }
  }

  return { installed, loaded, running, ...(pid ? { pid } : {}) };
}

export function installLaunchdService(spec: LaunchdSpec): InstallLaunchdResult {
  const plistPath = getLaunchdPlistPath(spec.homeDir);

  if (fs.existsSync(plistPath)) {
    const existing = fs.readFileSync(plistPath, "utf8");
    if (!existing.includes(`<string>${GATEWAY_SERVICE_LABEL}</string>`)) {
      return {
        plistPath,
        loaded: false,
        message: `存在同名但非本项目的服务文件，拒绝覆盖：${plistPath}（已写入 BLOCKED.md）`,
      };
    }
  }

  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  fs.writeFileSync(plistPath, buildLaunchdPlist(spec), "utf8");

  const domain = getGuiDomain();
  // 先 bootout 保证幂等，失败可忽略
  spawnSync("launchctl", ["bootout", domain, plistPath], { stdio: "ignore" });

  const bootstrap = spawnSync("launchctl", ["bootstrap", domain, plistPath], { encoding: "utf8" });
  if (bootstrap.status === 0) {
    return { plistPath, loaded: true, message: `已生成并加载 launchd 服务：${plistPath}` };
  }

  const legacyLoad = spawnSync("launchctl", ["load", "-w", plistPath], { encoding: "utf8" });
  if (legacyLoad.status === 0) {
    return { plistPath, loaded: true, message: `已生成并加载 launchd 服务：${plistPath}` };
  }

  return {
    plistPath,
    loaded: false,
    message: `已生成服务文件，但加载 launchd 失败：${plistPath}\n${bootstrap.stderr || legacyLoad.stderr || ""}`,
  };
}

export function uninstallLaunchdService(homeDir = os.homedir()): { message: string } {
  const plistPath = getLaunchdPlistPath(homeDir);
  const domain = getGuiDomain();

  spawnSync("launchctl", ["bootout", domain, plistPath], { stdio: "ignore" });
  spawnSync("launchctl", ["unload", plistPath], { stdio: "ignore" });

  let removed = false;
  try {
    fs.rmSync(plistPath, { force: true });
    removed = true;
  } catch {
    // 删除失败则保留，如实报告。
  }

  return {
    message: removed ? `已卸载并删除服务文件：${plistPath}` : `服务文件删除失败：${plistPath}`,
  };
}
