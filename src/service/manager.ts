import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChatterCatcherHome } from "../config/paths.js";
import { removeGatewayPidRecord, stopGatewayProcess } from "../gateway/runtime.js";
import { installLaunchdService, uninstallLaunchdService, getLaunchdServiceState, getLaunchdPlistPath } from "./launchd.js";
import { installSystemdService, uninstallSystemdService, getSystemdServiceState, getSystemdUnitPath } from "./systemd.js";

export type ServicePlatform = "launchd" | "systemd" | "unsupported";

export interface ServiceManagerContext {
  homeDir: string;
  chatterCatcherHome: string;
  cliEntry: string;
  nodePath: string;
}

export interface ServiceStatus {
  platform: ServicePlatform;
  installed: boolean;
  running: boolean;
  loaded?: boolean;
  pid?: number;
  serviceFile?: string;
  message: string;
}

export interface InstallServiceResult {
  platform: ServicePlatform;
  serviceFile: string;
  loaded: boolean;
  message: string;
}

export interface UninstallServiceResult {
  platform: ServicePlatform;
  message: string;
}

export function detectServicePlatform(): ServicePlatform {
  if (process.platform === "darwin") {
    return "launchd";
  }
  if (process.platform === "linux") {
    return "systemd";
  }
  return "unsupported";
}

export function resolveCliEntryPath(): string {
  const current = fileURLToPath(import.meta.url);
  if (current.endsWith(".js")) {
    return current;
  }
  // dev 模式（tsx src/cli.ts）下尝试定位已构建的 dist/cli.js
  const candidate = path.resolve(path.dirname(current), "..", "dist", "cli.js");
  return fs.existsSync(candidate) ? candidate : current;
}

function createContext(cliEntry: string): ServiceManagerContext {
  return {
    homeDir: os.homedir(),
    chatterCatcherHome: getChatterCatcherHome(),
    cliEntry,
    nodePath: process.execPath,
  };
}

function gatewayLogFile(chatterCatcherHome: string): string {
  return path.join(chatterCatcherHome, "logs", "gateway.log");
}

export function installService(cliEntry = resolveCliEntryPath()): InstallServiceResult {
  const platform = detectServicePlatform();
  if (platform === "unsupported") {
    return { platform, serviceFile: "", loaded: false, message: "当前平台不支持服务安装（仅支持 macOS/Linux）。" };
  }

  const context = createContext(cliEntry);
  const logFile = gatewayLogFile(context.chatterCatcherHome);

  if (platform === "launchd") {
    const result = installLaunchdService({
      nodePath: context.nodePath,
      cliEntry,
      logFile,
      homeDir: context.homeDir,
      chatterCatcherHome: context.chatterCatcherHome,
    });
    return { platform, serviceFile: result.plistPath, loaded: result.loaded, message: result.message };
  }

  const result = installSystemdService({
    cliEntry,
    workingDirectory: path.dirname(cliEntry),
    logFile,
    homeDir: context.homeDir,
    chatterCatcherHome: context.chatterCatcherHome,
  });
  return { platform, serviceFile: result.unitPath, loaded: false, message: result.message };
}

export function getServiceStatus(): ServiceStatus {
  const platform = detectServicePlatform();
  if (platform === "unsupported") {
    return { platform, installed: false, running: false, message: "当前平台不支持服务安装（仅支持 macOS/Linux）。" };
  }

  const context = createContext(resolveCliEntryPath());

  if (platform === "launchd") {
    const state = getLaunchdServiceState(context.homeDir);
    const plistPath = getLaunchdPlistPath(context.homeDir);
    return {
      platform,
      installed: state.installed,
      loaded: state.loaded,
      running: state.running,
      ...(state.pid ? { pid: state.pid } : {}),
      serviceFile: plistPath,
      message: state.running
        ? `launchd 服务正在运行：pid=${state.pid}`
        : state.loaded
          ? "launchd 服务已加载但未运行。"
          : state.installed
            ? "launchd 服务文件已安装但未加载。"
            : "launchd 服务未安装。",
    };
  }

  const state = getSystemdServiceState(context.homeDir);
  const unitPath = getSystemdUnitPath(context.homeDir);
  return {
    platform,
    installed: state.installed,
    running: state.running === true,
    serviceFile: unitPath,
    message:
      state.running === null
        ? state.installed
          ? "systemd 服务文件已安装（未真机验证，无法确认运行状态）。"
          : "systemd 服务未安装。"
        : state.running
          ? "systemd 服务正在运行。"
          : "systemd 服务未运行。",
  };
}

export function uninstallService(): UninstallServiceResult {
  const platform = detectServicePlatform();
  if (platform === "unsupported") {
    return { platform, message: "当前平台不支持服务安装（仅支持 macOS/Linux）。" };
  }

  const context = createContext(resolveCliEntryPath());
  // 先停止本机 gateway 进程并清理 pid 记录，保证卸载干净。
  stopGatewayProcess();
  removeGatewayPidRecord();

  if (platform === "launchd") {
    const result = uninstallLaunchdService(context.homeDir);
    return { platform, message: result.message };
  }

  const result = uninstallSystemdService(context.homeDir);
  return { platform, message: result.message };
}
