# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目协作约束

- 必须阅读并遵守 `AGENTS.md`；项目使命、RAG 原则、产品约束、开发流程、安全隐私和交付流程以 `AGENTS.md` 为准。
- 项目文档、spec、plan 默认使用中文。
- 不要重写或丢弃用户已有改动，除非用户明确要求。
- 必须遵守 superpowers 规范，包括 brainstorming、planning、TDD、verification、code review 等适用流程。
- 当用户明确要求"直接做""直接改""别问""按我说的做"或等价表达时，必须 100% 按用户指令直接执行，不再追问、不再强行展开形式化流程。
- 任务可并行时，优先使用 subagents 并行开发，而不是串行开发。
- 每完成一个小的、可验证的逻辑单元并通过对应检查后，就创建一次 git commit；提交前检查 `git status --short`，每个提交只包含当前逻辑单元相关文件。

## 常用开发命令

```bash
npm install
npm run dev -- --help          # 运行开发版 CLI
npm run lint                   # 当前等价于 tsc --noEmit
npm run typecheck              # TypeScript 类型检查
npm test                       # 运行全部 Vitest 测试
npm run build                  # tsup 构建 dist/ 和 d.ts
npm pack --dry-run             # 触发 prepack 构建并检查 npm 包内容
```

单测与局部验证：

```bash
npx vitest run tests/rag/hybrid-retriever.test.ts
npx vitest run tests/feishu/question.test.ts -t "case name"
npx vitest run tests/release/package-artifacts.test.ts
npx tsc --noEmit
```

常用本地运行/运维命令（开发版 CLI 用 `npm run dev --` 前缀替代已安装的 `chattercatcher`）：

```bash
chattercatcher setup
chattercatcher settings show
chattercatcher doctor --online
chattercatcher gateway start --foreground
chattercatcher gateway status
chattercatcher gateway stop
chattercatcher logs --follow --file gateway.log
chattercatcher process messages --limit 10000
chattercatcher process episodes
chattercatcher index status
chattercatcher index rebuild --limit 10000
chattercatcher files add <path...>
chattercatcher files jobs --limit 50
chattercatcher files list --limit 50
chattercatcher cron list
chattercatcher cron run
chattercatcher export --out ./backup.json
chattercatcher restore ./backup.json --replace
chattercatcher data delete message <messageId> --yes
chattercatcher web start
chattercatcher profiles list
chattercatcher profiles show <personId>
```

开发调试命令：

```bash
npm run dev -- dev ingest-message --text "测试消息"
npm run dev -- dev ingest-feishu-event --file ./event.json
npm run dev -- dev search "检索问题"
npm run dev -- dev ask "问答问题"
```

## 架构概览

ChatterCatcher 是 Node.js 20+ / TypeScript / ESM 项目，npm 包入口由 `tsup.config.ts` 构建：CLI 为 `src/cli.ts`，库入口为 `src/index.ts`，产物为 `dist/`。测试使用 Vitest，测试文件匹配 `tests/**/*.test.ts`。

核心运行路径：

```text
飞书/Lark WSClient -> EventDispatcher im.message.receive_v1
  -> FeishuQuestionHandler（@ 提问：工具循环/RAG/定时任务，提问不入库）
  -> GatewayIngestor（普通消息：归一化、成员名补全、附件下载、人物身份解析）
  -> MessageRepository / SQLite / FTS5 / 文件任务 / 图片多模态任务
  -> ProfileRepository（人物身份注册、档案条目管理）
  -> Dream Processor（周期性批量分析新消息，自动更新人物档案）
  -> episode summary、embedding indexing、cron scheduler 等后台处理
  -> Web UI / CLI 观察与手动触发
```

问答和检索路径：

```text
问题 -> createAgenticRagSearchTools/createHybridRetriever
  -> EpisodeFtsRetriever + MessageFtsRetriever + ProfileRetriever + 可选 VectorRetriever(SQLite embedding)
  -> HybridRetriever 重排
  -> OpenAI-compatible chat completions 生成答案
  -> citations / qa_logs / qa_trace 保存可追溯证据与工具调用过程
```

## 关键模块边界

- `src/cli.ts`：所有 CLI 命令装配层；这里组合配置、数据库、Feishu Gateway、RAG、Web UI、导入导出和调试命令，业务逻辑应尽量下沉到对应模块。
- `src/config/*`：`config.json` 与 `secrets.json` 的 schema、路径和保存逻辑；默认 home 为 `CHATTERCATCHER_HOME` 或 `~/.chattercatcher`，普通配置和密钥分开。
- `src/db/database.ts`：better-sqlite3 打开数据库并执行内联 migration；SQLite 同时存 chats/messages/chunks、FTS5、episode summaries、embedding JSON、qa logs、file jobs、cron jobs、图片多模态任务、人物档案和 Dream 状态。
- `src/messages/*`：消息入库、稳定 ID、chunking、FTS 写入和消息/文件查询。文件、图片转述和飞书消息最终都以 message/chunk 形式进入知识库。
- `src/feishu/*` 与 `src/gateway/*`：飞书长连接、事件归一化、消息入库、附件下载、成员昵称解析、发送回复和 gateway runtime/PID/log 管理。`@` 提问先由 `FeishuQuestionHandler` 处理并跳过知识库入库，避免污染检索。消息入库时自动解析人物身份。
- `src/profiles/*`：人物档案模块。包含 `PersonProfile` 数据模型、`ProfileRepository` 仓储、`ProfileDreamProcessor` 自动更新、`createProfileRagTools` RAG 检索工具和 Web UI API。
- `src/rag/*`：RAG 核心。包含 FTS retriever、SQLite embedding vector store、hybrid retriever、agentic search tools（含 profile 工具）、grounded answer、citations、qa logs/trace 和手动索引。
- `src/episodes/*`：将同一群聊的碎片消息按窗口和静默时间整理成 episode summary，并将摘要纳入 FTS/RAG。
- `src/files/*`：本地文件和飞书附件解析入库，支持 txt/md/json/csv/tsv/log/docx/pdf；解析后复制到 dataDir/files 并写成 `local-file` message。
- `src/multimodal/*`：图片附件的多模态转述任务，成功后创建 `image_summary` 派生消息，再进入 RAG。
- `src/cron/*`：群内自然语言定时任务；工具只管理当前群聊，scheduler 到期后使用 RAG 工具生成发送内容。
- `src/web/server.ts`：单文件 Fastify Web UI/API，读取本地 SQLite 状态、消息、文件、episode、QA trace、人物档案，并提供本地操作入口。
- `src/llm/openai-compatible.ts`：OpenAI-compatible chat/embedding 客户端；支持标准 tool calls，也兼容 DSML 工具调用标记。

## 当前实现约束

- RAG 是强制路径：事实性回答必须基于检索证据；不要通过把大量历史消息直接塞进上下文来绕过索引、检索和引用。
- SQLite FTS5 在消息入库时同步更新；`process messages` / `index rebuild` 主要用于补齐或重建 SQLite embedding 向量索引。
- Embedding 配置可复用 LLM base URL/API key；只有 `baseUrl + model + apiKey` 完整时才启用语义检索。
- Feishu Gateway 中普通消息会入库；被机器人识别为提问的 `@` 消息直接回答并跳过入库。
- 人物档案（Personal Profiles）消息入库时自动解析人物身份；Dream 处理器周期性更新档案条目。
- Web UI 默认监听 `127.0.0.1:3878`，不要默认改成公网监听。
- `restore --replace` 会清空再恢复本地知识库；未带 `--replace` 时合并恢复。数据删除命令会删除知识库记录和 dataDir 内保存文件，避免删除外部源文件。

## 发布纪律

每次发版必须：

- 更新 `CHANGELOG.md`，按时间倒序记录本次版本的新增、修复和变更。
- 确保 `package.json` 的 `files` 字段包含 `CHANGELOG.md`。
- `CHANGELOG.md` 使用中文，格式参考 https://keepachangelog.com/zh-CN/1.1.0/。
- 版本号遵守 SemVer。
- Claude 负责版本 bump、PR 创建和 merge；用户负责 `npm publish`。

## 文档与发布交付

- README 包含面向用户的安装、配置、功能和命令说明；架构/产品/计划分别维护在 `docs/TECHNICAL_ARCHITECTURE.md`、`docs/PRD.md`、`docs/DEVELOPMENT_PLAN.md`。
- 行为、范围或命令变化时同步更新对应中文文档。
- 完成编码后先汇报完成内容、验证结果、风险或未完成项并等待用户确认；用户确认后由 Claude 处理 npm 版本检查、必要 bump、PR、代理 review、修复、merge 和根目录同步；用户最终自己执行 `npm publish`。
