# 实现审计：文档 vs 代码

> 审计时间：2026-08-02 | 版本：0.2.7 | 测试：62 文件 / 295 测试全部通过
> 上次审计：2026-05-03（当时 46 文件 / 174 测试）

## 自上次审计以来已补齐

| 分类 | 缺失项 | 现状 |
|------|--------|------|
| 数据模型 | `qa_logs` 表未创建 | ✅ 已实现，含 `trace_json`（推理过程、工具调用、证据），见 `src/db/database.ts` |
| Web UI | 无问答日志页面 | ✅ 已实现 QA trace 列表与详情页（0.2.5），`GET /api/qa-logs`、`GET /api/qa-logs/:id` |
| 调度 | cron 索引调度器未运行 | ✅ 已实现 `src/gateway/indexing-scheduler.ts`，Gateway 启动时按 `schedules.indexing` 周期执行索引 |

## 缺失功能

| 序号 | 分类 | 缺失项 | 来源文档 | 说明 |
|------|------|--------|----------|------|
| 1 | 数据模型 | `facts` 表未创建 | TECHNICAL_ARCHITECTURE | subject/predicate/value/confidence/status 等列均缺失。当前冲突处理仅依赖 LLM prompt 规则，无持久化事实管道。属 M3 范围，可延后。 |
| 2 | 数据模型 | `file_jobs` 缺 sha256 / platform_file_key | TECHNICAL_ARCHITECTURE | 原设计的 `files` 表（含 platform_file_key、sha256、mime_type）未实现，`file_jobs` 合并了文件元数据和任务状态，digest 仅用于生成任务 ID，未持久化为独立列。 |
| 3 | Web UI | 无配置编辑功能 | PRD | PRD 要求"配置编辑"，Web UI 仅展示状态，无法修改配置。只能通过 CLI `chattercatcher settings` 修改。 |
| 4 | Web UI | 无重建索引 / 导出数据按钮 | PRD | PRD 要求"重建索引和导出数据"入口。Web UI 首页有"立即处理"按钮（等价 `process messages`），但无 `index rebuild` 和 `export` 按钮。 |
| 5 | 文件解析 | XLSX 解析器未实现 | PRD / DEVELOPMENT_PLAN | 仅支持 txt/md/json/csv/tsv/log/docx/pdf。Excel 文件无法解析。 |
| 6 | 文件解析 | PPTX 解析器未实现 | PRD / DEVELOPMENT_PLAN | PowerPoint 文件无法解析。 |
| 7 | 文件解析 | HTML / 链接元数据提取未实现 | DEVELOPMENT_PLAN | cheerio + readability 的 HTML 解析路径未实现。 |
| 8 | 文件解析 | 图片 OCR 路径未实现 | PRD / TECHNICAL_ARCHITECTURE | Tesseract.js 或视觉模型 OCR 均未接入。注意：图像多模态（AI 转述图片内容）已实现，但那是独立的 vision model 路径，不是 OCR 文字提取。 |
| 9 | 文件解析 | 语音转写路径未实现 | PRD / TECHNICAL_ARCHITECTURE | OpenAI-compatible transcription 和本地 Whisper 均未接入。 |
| 10 | 基础设施 | 服务安装未实现 | DEVELOPMENT_PLAN | Windows service / macOS launchd / Linux systemd 安装均缺失。属 M3 范围。 |
| 11 | 基础设施 | Docker 部署未实现 | DEVELOPMENT_PLAN | 属 M3 范围。 |

## 不完全实现

| 序号 | 分类 | 问题 | 来源文档 | 现状 | 差距 |
|------|------|------|----------|------|------|
| 1 | 文件解析 | M2"文件成为知识源" | DEVELOPMENT_PLAN | 完成度约 60% | 仅 8 种文本格式和 pdf/docx 可用，缺少 5 种解析器（见上表）。 |
| 2 | M3 | "可信的家庭知识库" | DEVELOPMENT_PLAN | 完成度约 30% | export/restore/data delete、群内自然语言定时任务（可承担定时摘要）已实现；facts 管道、服务安装、parser 插件接口均缺失。episode 摘要仍仅在消息到达时被动触发或 CLI 手动触发。 |
| 3 | 冲突处理 | 无持久化事实版本历史 | PRD / TECHNICAL_ARCHITECTURE | LLM prompt 层面处理 | 文档设计要求 facts 表支持 active/superseded/ambiguous 状态跟踪，当前仅通过 prompt 规则实现，无历史追溯能力。 |

## 已符合的硬约束

| 约束 | 来源 | 状态 |
|------|------|------|
| RAG 强制：所有回答必须先检索证据 | AGENTS.md / PRD | ✅ 通过 Agentic RAG 强制执行 |
| 禁止全量上下文堆叠 | AGENTS.md | ✅ `generateGroundedAnswer()` 仅接收 evidence blocks |
| 证据不足时说不知道 | PRD | ✅ 返回"不知道。当前本地知识库没有检索到足够证据。" |
| 事实回答必须带引用 | PRD / AGENTS.md | ✅ `[S1]` 标记格式 |
| 配置与密钥分离 | PRD / 架构 | ✅ config.json / secrets.json |
| 导出不含密钥 | PRD / 架构 | ✅ 导出备注说明 |
| Web UI 默认只监听 127.0.0.1 | PRD / 架构 | ✅ |
| 本地优先运行 | PRD | ✅ |
| @ 提问不进入知识库 | README / 架构 | ✅ 提问直接回答并跳过入库 |
| 仅支持飞书/Lark | PRD | ✅ |
| 仅 OpenAI-compatible API | PRD / 架构 | ✅ |
