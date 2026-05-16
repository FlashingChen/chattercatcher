#!/usr/bin/env node
import { input, password, select, confirm, number } from "@inquirer/prompts";
import { Command } from "commander";
import fs from "node:fs/promises";
import packageJson from "../package.json" with { type: "json" };
import type { AppConfig, AppSecrets } from "./config/schema.js";
import { loadConfig, loadSecrets, resetConfigFiles, saveConfig, saveSecrets, ensureConfigFiles, maskSecret } from "./config/store.js";
import { applySecretInput, resolveEmbeddingApiKey } from "./config/update.js";
import { getChatterCatcherHome, getConfigPath, getSecretsPath } from "./config/paths.js";
import { deleteLocalData, type DeleteTargetType } from "./data/deletion.js";
import { getDatabasePath, openDatabase } from "./db/database.js";
import { formatDoctorChecks, runDoctor } from "./doctor/checks.js";
import { exportLocalData } from "./export/data-export.js";
import { restoreLocalData } from "./export/data-restore.js";
import { processEpisodesNow } from "./episodes/manual-process.js";
import { ensureFeishuBotOpenId } from "./feishu/bot-info.js";
import { createFeishuGateway } from "./feishu/gateway.js";
import type { FeishuReceiveMessageEvent } from "./feishu/normalize.js";
import { FeishuQuestionHandler } from "./feishu/question.js";
import { FeishuResourceDownloader } from "./feishu/resource-downloader.js";
import { createFeishuChatMembersClient, FeishuMemberRepository, FeishuMemberResolver } from "./feishu/members.js";
import { FeishuMessageSender, mapDomain } from "./feishu/sender.js";
import { ingestLocalFile } from "./files/ingest.js";
import { FileJobRepository } from "./files/jobs.js";
import { GatewayIngestor } from "./gateway/ingest.js";
import { startDetachedGateway } from "./gateway/detached.js";
import { getGatewayStatus } from "./gateway/index.js";
import { getGatewayLogPath, removeGatewayPidRecord, stopGatewayProcess, writeGatewayPidRecord } from "./gateway/runtime.js";
import { createChatModel, createEmbeddingModel } from "./llm/openai-compatible.js";
import { createMultimodalModel } from "./multimodal/openai-compatible.js";
import * as lark from "@larksuiteoapi/node-sdk";
import { followLogFile, getLogsDirectory, normalizeLineCount, readLatestLogTail } from "./logs/reader.js";
import { MessageRepository } from "./messages/repository.js";
import { indexMessageChunks } from "./rag/indexer.js";
import { createHybridRetriever, hasEmbeddingConfig } from "./rag/factory.js";
import { processMessagesNow } from "./rag/manual-index.js";
import { SqliteVectorStore } from "./rag/sqlite-vector-store.js";
import { askWithRag } from "./rag/qa-service.js";
import { formatCitation } from "./rag/citations.js";
import { updateChatterCatcher } from "./update/npm-updater.js";
import { startWebServer } from "./web/server.js";

const program = new Command();

async function promptForConfiguration(config: AppConfig, secrets: AppSecrets): Promise<void> {
  config.feishu.domain = await select({
    message: "选择飞书区域",
    choices: [
      { name: "飞书（中国）", value: "feishu" as const },
      { name: "Lark（国际）", value: "lark" as const },
    ],
    default: config.feishu.domain,
  });
  config.feishu.appId = await input({ message: "飞书 App ID", default: config.feishu.appId });
  secrets.feishu.appSecret = applySecretInput(
    secrets.feishu.appSecret,
    await password({ message: secrets.feishu.appSecret ? "飞书 App Secret（留空保留）" : "飞书 App Secret", mask: "*" }),
  );
  await tryEnsureFeishuBotOpenId(config, secrets);

  config.llm.baseUrl = await input({ message: "LLM Base URL（OpenAI-compatible）", default: config.llm.baseUrl });
  secrets.llm.apiKey = applySecretInput(
    secrets.llm.apiKey,
    await password({ message: secrets.llm.apiKey ? "LLM API Key（留空保留）" : "LLM API Key", mask: "*" }),
  );
  config.llm.model = await input({ message: "Chat Model", default: config.llm.model });

  config.embedding.baseUrl = await input({
    message: "Embedding Base URL（留空则使用 LLM Base URL）",
    default: config.embedding.baseUrl || config.llm.baseUrl,
  });
  secrets.embedding.apiKey = resolveEmbeddingApiKey({
    currentEmbeddingKey: secrets.embedding.apiKey,
    nextEmbeddingKey: await password({
      message: secrets.embedding.apiKey ? "Embedding API Key（留空保留）" : "Embedding API Key（留空则使用 LLM API Key）",
      mask: "*",
    }),
    llmApiKey: secrets.llm.apiKey,
  });
  config.embedding.model = await input({ message: "Embedding Model", default: config.embedding.model });
  const multimodalBaseUrl = await input({
    message: "Multimodal Base URL（OpenAI-compatible，可留空）",
    default: config.multimodal.baseUrl,
  });
  const multimodalApiKey = await password({
    message: "Multimodal API Key（可留空）",
    mask: "*",
  });
  const multimodalModel = await input({
    message: "Multimodal Model（可留空）",
    default: config.multimodal.model,
  });
  const dimension = await number({
    message: "Embedding 维度（不知道可先留空）",
    default: config.embedding.dimension ?? undefined,
    required: false,
  });
  config.embedding.dimension = dimension ?? null;
  config.multimodal = {
    baseUrl: multimodalBaseUrl,
    model: multimodalModel,
  };

  secrets.multimodal = {
    apiKey: multimodalApiKey || secrets.multimodal.apiKey,
  };

  config.web.port =
    (await number({ message: "Web UI 端口", default: config.web.port, required: true })) ?? config.web.port;
  config.feishu.requireMention = await confirm({
    message: "群聊回答是否要求 @ 机器人？",
    default: config.feishu.requireMention,
  });
  config.episodes.windowMinutes =
    (await number({ message: "会话记忆聚合窗口（分钟）", default: config.episodes.windowMinutes, required: true })) ??
    config.episodes.windowMinutes;
  config.episodes.quietMinutes =
    (await number({ message: "会话静默多久后生成记忆（分钟）", default: config.episodes.quietMinutes, required: true })) ??
    config.episodes.quietMinutes;
}

async function tryEnsureFeishuBotOpenId(config: AppConfig, secrets: AppSecrets): Promise<void> {
  if (config.feishu.botOpenId || !config.feishu.appId || !secrets.feishu.appSecret) {
    return;
  }

  try {
    const openId = await ensureFeishuBotOpenId(config, secrets, { onSave: () => saveConfig(config) });
    console.log(`已自动获取飞书机器人 Open ID：${openId}`);
  } catch (error) {
    console.log(`暂时无法自动获取飞书机器人 Open ID：${error instanceof Error ? error.message : String(error)}`);
  }
}

function printSettings(config: AppConfig, secrets: AppSecrets): void {
  console.log(JSON.stringify(
    {
      home: getChatterCatcherHome(),
      config,
      secrets: {
        feishu: { appSecret: maskSecret(secrets.feishu.appSecret) },
        llm: { apiKey: maskSecret(secrets.llm.apiKey) },
        embedding: { apiKey: maskSecret(secrets.embedding.apiKey) },
        multimodal: { apiKey: maskSecret(secrets.multimodal.apiKey) },
      },
    },
    null,
    2,
  ));
}

program
  .name("chattercatcher")
  .description("本地优先的飞书/Lark 家庭群知识机器人")
  .version(packageJson.version);

program.command("setup").description("交互式初始化配置").action(async () => {
  const { config, secrets } = await ensureConfigFiles();
  await promptForConfiguration(config, secrets);
  await saveConfig(config);
  await saveSecrets(secrets);
  console.log(`配置已保存：${getConfigPath()}`);
  console.log(`密钥已保存：${getSecretsPath()}`);
});

const settings = program.command("settings").description("查看或修改配置");

settings.action(async () => {
  const { config, secrets } = await ensureConfigFiles();
  await promptForConfiguration(config, secrets);
  await saveConfig(config);
  await saveSecrets(secrets);
  console.log(`配置已更新：${getConfigPath()}`);
  console.log(`密钥已更新：${getSecretsPath()}`);
});

settings.command("show").description("查看当前配置（密钥脱敏）").action(async () => {
  printSettings(await loadConfig(), await loadSecrets());
});

settings.command("reset").description("重置本地配置和密钥").action(async () => {
  const shouldReset = await confirm({ message: "确认重置 ChatterCatcher 配置？", default: false });
  if (!shouldReset) {
    console.log("已取消。");
    return;
  }

  await resetConfigFiles();
  console.log("配置已重置。");
});

program.command("doctor").description("检查本地配置、存储和可选在线连通性").option("--online", "检查 LLM 和 Embedding 接口连通性").action(async (options: { online?: boolean }) => {
  const config = await loadConfig();
  const secrets = await loadSecrets();
  const checks = await runDoctor(config, secrets, { online: options.online });
  console.log(formatDoctorChecks(checks));
});

program.command("update").description("升级 ChatterCatcher 到 npm 最新版本").option("--dry-run", "只检查并显示将执行的升级命令").action(async (options: { dryRun?: boolean }) => {
  const result = await updateChatterCatcher({ currentVersion: packageJson.version, dryRun: options.dryRun });

  if (result.status === "up-to-date") {
    console.log(`ChatterCatcher 已是最新版本：${result.currentVersion}`);
    return;
  }

  if (result.status === "dry-run") {
    console.log(`当前版本：${result.currentVersion}`);
    console.log(`最新版本：${result.latestVersion}`);
    console.log(`将执行：${result.command}`);
    return;
  }

  if (result.status === "updated") {
    console.log(`升级完成：${result.currentVersion} -> ${result.latestVersion}`);
    console.log("请重新打开终端或重新运行 chattercatcher --version 确认版本。");
    return;
  }

  if (result.status === "query-failed") {
    console.error(`无法获取最新版本：${result.error}`);
    process.exitCode = 1;
    return;
  }

  console.error(`升级失败：${result.error}`);
  console.error(`可手动运行：${result.command}`);
  process.exitCode = 1;
});

const gateway = program.command("gateway").description("管理本地飞书 Gateway");

async function startGatewayForegroundCommand(): Promise<void> {
  const config = await loadConfig();
  const secrets = await loadSecrets();
  const status = getGatewayStatus(config, secrets);
  const pidRecordBase = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    command: process.argv.join(" "),
    logFile: getGatewayLogPath(),
  };

  if (!status.configured) {
    writeGatewayPidRecord(undefined, {
      ...pidRecordBase,
      mode: "web",
    });
    console.log(status.message);
    console.log("本地 Web UI 仍会启动，方便继续配置。");
    await startWebServer(config, { version: packageJson.version });
    return;
  }

  await tryEnsureFeishuBotOpenId(config, secrets);

  writeGatewayPidRecord(undefined, {
    ...pidRecordBase,
    mode: "gateway",
  });

  const database = openDatabase(config);
  const chatModel = createChatModel(config, secrets);
  const sender = FeishuMessageSender.fromConfig(config, secrets);
  const memberResolver = new FeishuMemberResolver({
    repository: new FeishuMemberRepository(database),
    client: createFeishuChatMembersClient(new lark.Client({
      appId: config.feishu.appId,
      appSecret: secrets.feishu.appSecret,
      domain: mapDomain(config.feishu.domain),
    }) as Parameters<typeof createFeishuChatMembersClient>[0]),
  });
  const vectorStore = hasEmbeddingConfig(config, secrets)
    ? new SqliteVectorStore(database, { model: config.embedding.model })
    : null;
  const gatewayRuntime = createFeishuGateway({
    config,
    secrets,
    ingestor: new GatewayIngestor(database),
    resourceDownloader: FeishuResourceDownloader.fromConfig(config, secrets),
    attachmentVectorIndexer: vectorStore
      ? (messageId) =>
          indexMessageChunks({
            messages: new MessageRepository(database),
            embedding: createEmbeddingModel(config, secrets),
            store: vectorStore,
            messageIds: [messageId],
          })
      : undefined,
    episodeProcessor: {
      database,
      model: chatModel,
    },
    imageMultimodalProcessor:
      config.multimodal.baseUrl && config.multimodal.model && secrets.multimodal.apiKey
        ? {
            database,
            model: createMultimodalModel(config, secrets),
          }
        : undefined,
    indexingProcessor: {
      database,
    },
    cronJobProcessor: {
      database,
      model: chatModel,
      sender,
    },
    questionHandler: new FeishuQuestionHandler({
      config,
      secrets,
      database,
      memberResolver,
      sender,
      model: chatModel,
    }),
  });

  const cleanup = () => {
    gatewayRuntime.stop();
    database.close();
    removeGatewayPidRecord();
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  console.log(status.message);

  try {
    await gatewayRuntime.start();
    await startWebServer(config, { version: packageJson.version });
  } catch (error) {
    cleanup();
    throw error;
  }
}

async function startGatewayCommand(options: { foreground?: boolean } = {}): Promise<void> {
  if (options.foreground) {
    await startGatewayForegroundCommand();
    return;
  }

  const config = await loadConfig();
  const secrets = await loadSecrets();
  await tryEnsureFeishuBotOpenId(config, secrets);
  const result = await startDetachedGateway({ config, secrets });

  console.log(result.message);
  if (result.pid) {
    console.log(`PID：${result.pid}`);
  }
  console.log(`日志文件：${result.logFile}`);
  console.log("查看日志：chattercatcher logs --follow --file gateway.log");
  console.log("停止 Gateway：chattercatcher gateway stop");
}

gateway.command("status").description("查看 Gateway 状态").action(async () => {
  const config = await loadConfig();
  const secrets = await loadSecrets();
  console.log(JSON.stringify(getGatewayStatus(config, secrets), null, 2));
});

gateway
  .command("start")
  .description("启动飞书长连接 Gateway 和本地 Web UI")
  .option("--foreground", "在当前终端以前台模式运行")
  .action(startGatewayCommand);

gateway.command("stop").description("停止 Gateway").action(() => {
  console.log(stopGatewayProcess().message);
});

gateway.command("restart").description("重启 Gateway").action(async () => {
  console.log(stopGatewayProcess().message);
  await startGatewayCommand();
});

const web = program.command("web").description("管理本地 Web UI");

web.command("start").description("启动本地 Web UI").action(async () => {
  const config = await loadConfig();
  await startWebServer(config, { version: packageJson.version });
});

const data = program.command("data").description("管理本地知识库数据");

async function deleteDataCommand(targetType: DeleteTargetType, targetId: string, options: { yes?: boolean }): Promise<void> {
  const shouldDelete =
    options.yes ||
    (await confirm({
      message: `确认删除 ${targetType}=${targetId} 的本地知识库记录？`,
      default: false,
    }));

  if (!shouldDelete) {
    console.log("已取消。");
    return;
  }

  const config = await loadConfig();
  const database = openDatabase(config);
  try {
    const result = await deleteLocalData({ config, database, targetType, targetId });
    console.log(
      `删除完成：messages=${result.deletedMessages}，chunks=${result.deletedChunks}，fileJobs=${result.deletedFileJobs}，chats=${result.deletedChats}`,
    );
    if (result.deletedStoredFiles.length > 0) {
      console.log(`已删除本地保存文件：${result.deletedStoredFiles.join("；")}`);
    }
    if (result.skippedStoredFiles.length > 0) {
      console.log(`跳过非数据目录文件：${result.skippedStoredFiles.join("；")}`);
    }
    console.log("SQLite FTS 已同步删除；如使用 SQLite embedding 语义检索，请运行 chattercatcher index rebuild。");
  } finally {
    database.close();
  }
}

const dataDelete = data.command("delete").description("删除指定本地知识库数据");

dataDelete
  .command("message")
  .description("按消息 ID 删除一条消息及其 RAG chunks")
  .argument("<messageId>", "消息 ID")
  .option("--yes", "跳过确认")
  .action((messageId: string, options: { yes?: boolean }) => deleteDataCommand("message", messageId, options));

dataDelete
  .command("file")
  .description("按文件消息 ID 删除文件知识源、解析任务和 dataDir 内保存文件")
  .argument("<messageId>", "文件消息 ID")
  .option("--yes", "跳过确认")
  .action((messageId: string, options: { yes?: boolean }) => deleteDataCommand("file", messageId, options));

dataDelete
  .command("chat")
  .description("按群聊 ID 删除该群聊下的消息和 RAG chunks")
  .argument("<chatId>", "群聊 ID")
  .option("--yes", "跳过确认")
  .action((chatId: string, options: { yes?: boolean }) => deleteDataCommand("chat", chatId, options));

const index = program.command("index").description("管理 RAG 索引");

index.command("status").description("查看索引状态").action(async () => {
  const config = await loadConfig();
  const secrets = await loadSecrets();
  const database = openDatabase(config);

  try {
    const messages = new MessageRepository(database);
    const vectorStore = new SqliteVectorStore(database, { model: config.embedding.model });
    const vectors = vectorStore.count();
    console.log(JSON.stringify(
      {
        database: getDatabasePath(config),
        chats: messages.getChatCount(),
        messages: messages.getMessageCount(),
        embeddings: {
          backend: "SQLite embedding 向量索引",
          configured: hasEmbeddingConfig(config, secrets),
          model: config.embedding.model,
          vectors,
          status: hasEmbeddingConfig(config, secrets)
            ? "SQLite embedding 向量索引已可用于语义检索"
            : "SQLite embedding 向量索引已接入；需配置 embedding 后启用语义检索",
        },
        retrieval: {
          keyword: "SQLite FTS5",
          vector: "SQLite embedding 向量索引",
          hybrid: "启用：SQLite FTS + SQLite embedding 向量检索",
          rag: "强制先检索证据再回答，禁止全量上下文堆叠",
        },
      },
      null,
      2,
    ));
  } finally {
    database.close();
  }
});

index.command("rebuild").description("重建语义向量索引").option("--limit <number>", "最多索引的 chunk 数", "10000").action(async (options: { limit: string }) => {
  const config = await loadConfig();
  const secrets = await loadSecrets();

  if (!hasEmbeddingConfig(config, secrets)) {
    console.log("Embedding 配置不完整，无法重建 SQLite embedding 向量索引。请运行 chattercatcher setup 或 chattercatcher settings。");
    return;
  }

  const database = openDatabase(config);
  const limit = Number(options.limit);

  try {
    const result = await processMessagesNow({
      config,
      secrets,
      database,
      limit: Number.isFinite(limit) ? limit : 10000,
    });

    if (result.status === "skipped") {
      console.log(`处理跳过：${result.reason}`);
      return;
    }

    console.log(`SQLite embedding 向量索引完成：chunks=${result.chunks}, vectors=${result.vectors}`);
  } finally {
    database.close();
  }
});

const processCommand = program.command("process").description("立即处理后台任务");

processCommand
  .command("messages")
  .description("立即处理消息索引任务，把消息 chunks 写入 SQLite embedding 向量索引")
  .option("--limit <number>", "最多处理的 chunk 数", "10000")
  .action(async (options: { limit: string }) => {
    const config = await loadConfig();
    const secrets = await loadSecrets();
    const database = openDatabase(config);
    const limit = Number(options.limit);

    try {
      const result = await processMessagesNow({
        config,
        secrets,
        database,
        limit: Number.isFinite(limit) ? limit : 10000,
      });
      if (result.status === "skipped") {
        console.log(`处理跳过：${result.reason}`);
        return;
      }

      console.log(`消息处理完成：chunks=${result.chunks}, vectors=${result.vectors}`);
    } finally {
      database.close();
    }
  });

processCommand
  .command("episodes")
  .description("立即生成会话记忆块，把碎片化闲聊整理成可检索摘要")
  .action(async () => {
    const config = await loadConfig();
    const secrets = await loadSecrets();
    const database = openDatabase(config);

    try {
      const result = await processEpisodesNow({
        config,
        secrets,
        database,
        model: createChatModel(config, secrets),
      });
      console.log(`会话记忆处理完成：episodes=${result.created}`);
    } finally {
      database.close();
    }
  });

const files = program.command("files").description("管理本地文件知识源");

files
  .command("add")
  .description("把本地文件解析、保存到数据目录并写入 RAG 知识库")
  .argument("<paths...>", "文件路径，支持 txt、md、json、csv、tsv、log、docx、pdf")
  .action(async (paths: string[]) => {
    const config = await loadConfig();
    const database = openDatabase(config);
    const messages = new MessageRepository(database);
    const jobs = new FileJobRepository(database);

    try {
      for (const filePath of paths) {
        const result = await ingestLocalFile({ config, messages, jobs, filePath });
        console.log(
          `已导入文件：${result.fileName}，解析器=${result.parser}，字符数=${result.characters}，消息ID=${result.messageId}`,
        );
      }
      console.log("文件已进入 SQLite FTS 检索；如已配置 embedding，可运行 chattercatcher index rebuild 更新 SQLite embedding 向量索引。");
    } finally {
      database.close();
    }
  });

files
  .command("jobs")
  .description("查看文件解析任务状态")
  .option("--limit <number>", "最多显示的任务数", "50")
  .option("--status <status>", "按状态过滤：processing、indexed、failed")
  .action(async (options: { limit: string; status?: string }) => {
    const config = await loadConfig();
    const database = openDatabase(config);
    const limit = Number(options.limit);

    try {
      const status =
        options.status === "processing" || options.status === "indexed" || options.status === "failed"
          ? options.status
          : undefined;
      const jobs = new FileJobRepository(database).list(Number.isFinite(limit) ? limit : 50, { status });
      if (jobs.length === 0) {
        console.log("还没有文件解析任务。");
        return;
      }

      for (const job of jobs) {
        console.log(
          `${job.fileName} | ID=${job.id} | 状态=${job.status} | 解析器=${job.parser ?? "-"} | 更新时间=${job.updatedAt}`,
        );
        if (job.error) {
          console.log(`  错误：${job.error}`);
        }
        if (job.storedPath) {
          console.log(`  本地保存：${job.storedPath}`);
        }
      }
    } finally {
      database.close();
    }
  });

files
  .command("retry")
  .description("重试一个失败的文件解析任务")
  .argument("<jobId>", "文件解析任务 ID")
  .action(async (jobId: string) => {
    const config = await loadConfig();
    const database = openDatabase(config);
    const jobs = new FileJobRepository(database);
    const messages = new MessageRepository(database);

    try {
      const job = jobs.get(jobId);
      if (!job) {
        console.log(`没有找到文件解析任务：${jobId}`);
        return;
      }

      const result = await ingestLocalFile({
        config,
        messages,
        jobs,
        filePath: job.sourcePath,
      });
      console.log(
        `重试完成：${result.fileName}，状态=indexed，解析器=${result.parser}，消息ID=${result.messageId}`,
      );
    } finally {
      database.close();
    }
  });

files
  .command("list")
  .description("查看已进入 RAG 的本地文件")
  .option("--limit <number>", "最多显示的文件数", "50")
  .action(async (options: { limit: string }) => {
    const config = await loadConfig();
    const database = openDatabase(config);
    const messages = new MessageRepository(database);
    const limit = Number(options.limit);

    try {
      const files = messages.listFiles(Number.isFinite(limit) ? limit : 50);
      if (files.length === 0) {
        console.log("还没有文件。可运行 chattercatcher files add <path...> 导入文件。");
        return;
      }

      for (const file of files) {
        console.log(
          `${file.fileName} | 解析器=${file.parser ?? "unknown"} | 字符数=${file.characters} | 导入时间=${file.importedAt}`,
        );
        if (file.parserWarnings?.length) {
          console.log(`  解析警告：${file.parserWarnings.join("；")}`);
        }
        if (file.storedPath) {
          console.log(`  本地保存：${file.storedPath}`);
        }
      }
    } finally {
      database.close();
    }
  });

program.command("logs").description("查看本地日志").option("--follow", "持续输出日志").option("--lines <number>", "显示末尾行数", "200").option("--file <name>", "指定日志文件名或绝对路径").action(async (options: { follow?: boolean; lines?: string; file?: string }) => {
  const result = await readLatestLogTail({
    fileName: options.file,
    lines: normalizeLineCount(options.lines),
  });

  if (!result) {
    console.log(`还没有日志文件：${getLogsDirectory()}`);
    return;
  }

  console.log(`日志文件：${result.file.path}`);
  if (result.content) {
    console.log(result.content);
  }

  if (!options.follow) {
    return;
  }

  const stop = await followLogFile({
    filePath: result.file.path,
    onChunk: (chunk) => process.stdout.write(chunk),
    onError: (error) => console.error(`日志跟随失败：${error.message}`),
  });

  const shutdown = () => {
    stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await new Promise(() => undefined);
});

program.command("export").description("导出本地知识库数据（不包含密钥）").option("--out <path>", "导出 JSON 文件路径").action(async (options: { out?: string }) => {
  const config = await loadConfig();
  const database = openDatabase(config);

  try {
    const result = await exportLocalData({ config, database, outputPath: options.out });
    console.log(`导出完成：${result.outputPath}`);
    console.log(`包含：群聊=${result.chats}，消息=${result.messages}，chunks=${result.chunks}，文件任务=${result.fileJobs}`);
  } finally {
    database.close();
  }
});

program.command("restore").description("从 ChatterCatcher 导出文件恢复本地知识库数据").argument("<file>", "导出的 JSON 文件").option("--replace", "先清空当前本地知识库，再恢复").action(async (file: string, options: { replace?: boolean }) => {
  const config = await loadConfig();
  const database = openDatabase(config);

  try {
    const result = await restoreLocalData({ database, inputPath: file, replace: options.replace });
    console.log(`恢复完成：${result.inputPath}`);
    console.log(`模式：${result.mode === "replace" ? "替换" : "合并"}`);
    console.log(`包含：群聊=${result.chats}，消息=${result.messages}，chunks=${result.chunks}，文件任务=${result.fileJobs}`);
    console.log("SQLite FTS 已重建；如使用 SQLite embedding 语义检索，请运行 chattercatcher index rebuild。");
  } finally {
    database.close();
  }
});

const dev = program.command("dev").description("开发调试命令");

dev
  .command("ingest-message")
  .description("写入一条本地测试消息")
  .requiredOption("--text <text>", "消息文本")
  .option("--chat <name>", "群名", "家庭群")
  .option("--sender <name>", "发送人", "测试用户")
  .action(async (options: { text: string; chat: string; sender: string }) => {
    const config = await loadConfig();
    const database = openDatabase(config);
    const messages = new MessageRepository(database);
    const now = new Date().toISOString();
    const id = messages.ingest({
      platform: "dev",
      platformChatId: options.chat,
      chatName: options.chat,
      platformMessageId: `dev-${Date.now()}`,
      senderId: options.sender,
      senderName: options.sender,
      messageType: "text",
      text: options.text,
      sentAt: now,
      rawPayload: { dev: true },
    });

    console.log(`已写入消息：${id}`);
    database.close();
  });

dev
  .command("ingest-feishu-event")
  .description("从 JSON 文件模拟写入一条飞书消息事件")
  .requiredOption("--file <path>", "飞书事件 JSON 文件")
  .action(async (options: { file: string }) => {
    const config = await loadConfig();
    const database = openDatabase(config);

    try {
      const raw = await fs.readFile(options.file, "utf8");
      const payload = JSON.parse(raw) as FeishuReceiveMessageEvent;
      const result = new GatewayIngestor(database).ingestFeishuEvent(payload);

      if (!result.accepted) {
        console.log(result.reason);
        return;
      }

      console.log(`已写入飞书消息：${result.messageId}`);
    } finally {
      database.close();
    }
  });

dev
  .command("search")
  .description("通过本地 FTS 检索测试 RAG 证据")
  .argument("<question>", "检索问题")
  .action(async (question: string) => {
    const config = await loadConfig();
    const secrets = await loadSecrets();
    const database = openDatabase(config);
    const { retriever, close } = await createHybridRetriever({
      config,
      secrets,
      database,
      messages: new MessageRepository(database),
    });
    const evidence = await retriever.retrieve(question);

    if (evidence.length === 0) {
      console.log("没有检索到证据。");
      close();
      database.close();
      return;
    }

    console.log(JSON.stringify(evidence, null, 2));
    close();
    database.close();
  });

dev
  .command("ask")
  .description("通过本地检索证据调用 LLM 回答")
  .argument("<question>", "问题")
  .action(async (question: string) => {
    const config = await loadConfig();
    const secrets = await loadSecrets();
    const database = openDatabase(config);
    const { retriever, close } = await createHybridRetriever({
      config,
      secrets,
      database,
      messages: new MessageRepository(database),
    });

    try {
      const result = await askWithRag({
        question,
        retriever,
        model: createChatModel(config, secrets),
      });

      console.log(result.answer);
      if (result.citations.length > 0) {
        console.log("\n引用：");
        for (const citation of result.citations) {
          console.log(`- ${formatCitation(citation)}`);
        }
      }
    } finally {
      close();
      database.close();
    }
  });

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
