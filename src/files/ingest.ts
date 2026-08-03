import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config/schema.js";
import { resolveHomePath } from "../config/paths.js";
import type { MessageRepository } from "../messages/repository.js";
import { describeSupportedParseTypes, isSupportedParseFile, parseFileToText } from "./parser.js";
import type { FileJobRepository } from "./jobs.js";

export interface IngestLocalFileResult {
  messageId: string;
  sourcePath: string;
  storedPath: string;
  fileName: string;
  bytes: number;
  characters: number;
  parser: string;
  warnings: string[];
  jobId?: string;
  contentSha256?: string;
  platformFileKey?: string;
}

export function isSupportedTextFile(filePath: string): boolean {
  return isSupportedParseFile(filePath);
}

function ensureSupportedTextFile(filePath: string): void {
  if (!isSupportedTextFile(filePath)) {
    const extension = path.extname(filePath).toLowerCase();
    throw new Error(`暂不支持该文件类型：${extension || "无扩展名"}。当前支持 ${describeSupportedParseTypes()}。`);
  }
}

function stableStoredName(sourcePath: string, fileName: string): string {
  const digest = crypto.createHash("sha256").update(sourcePath).digest("hex").slice(0, 16);
  return `${digest}-${fileName}`;
}

async function hashFileContent(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

export async function ingestLocalFile(input: {
  config: AppConfig;
  messages: MessageRepository;
  filePath: string;
  jobs?: FileJobRepository;
  platformFileKey?: string;
}): Promise<IngestLocalFileResult> {
  const sourcePath = path.resolve(input.filePath);
  const fileName = path.basename(sourcePath);
  const jobId = input.jobs?.start({ sourcePath, fileName, platformFileKey: input.platformFileKey });

  try {
    ensureSupportedTextFile(sourcePath);

    const stat = await fs.stat(sourcePath);
    if (!stat.isFile()) {
      throw new Error(`不是文件：${sourcePath}`);
    }

    const parsed = await parseFileToText(sourcePath);
    const text = parsed.text.trim();
    if (!text) {
      throw new Error(`文件没有可索引文本：${sourcePath}`);
    }

    const fileDir = path.join(resolveHomePath(input.config.storage.dataDir), "files");
    await fs.mkdir(fileDir, { recursive: true });

    const storedPath = path.join(fileDir, stableStoredName(sourcePath, fileName));
    await fs.copyFile(sourcePath, storedPath);

    const contentSha256 = await hashFileContent(storedPath);

    const messageId = input.messages.ingest({
      platform: "local-file",
      platformChatId: "local-files",
      chatName: "文件库",
      platformMessageId: sourcePath,
      senderId: "local-file",
      senderName: fileName,
      messageType: "file",
      text,
      sentAt: stat.mtime.toISOString(),
      rawPayload: {
        sourcePath,
        storedPath,
        bytes: stat.size,
        fileName,
        parser: parsed.parser,
        parserWarnings: parsed.warnings,
      },
    });

    input.jobs?.complete({
      id: jobId ?? "",
      storedPath,
      parser: parsed.parser,
      messageId,
      bytes: stat.size,
      characters: text.length,
      warnings: parsed.warnings,
      contentSha256,
    });

    return {
      messageId,
      sourcePath,
      storedPath,
      fileName,
      bytes: stat.size,
      characters: text.length,
      parser: parsed.parser,
      warnings: parsed.warnings,
      jobId,
      contentSha256,
      platformFileKey: input.platformFileKey,
    };
  } catch (error) {
    if (jobId) {
      input.jobs?.fail({
        id: jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}
