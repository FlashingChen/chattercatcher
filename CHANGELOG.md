# Changelog

## [Unreleased]

### Added
- 文件溯源：`file_jobs` 持久化文件内容 `content_sha256` 与飞书 `platform_file_key`，存量行迁移时按 stored_path 文件回填 sha256（文件缺失则留空，不编造），飞书附件路径把 `attachment.fileKey` 传入落列。
- 开机自启服务：新增 `chattercatcher service install/status/uninstall`。macOS 生成 `~/Library/LaunchAgents/com.chattercatcher.gateway.plist`（launchd，KeepAlive + RunAtLoad，日志写 logs/）并真机验证；Linux 生成 `~/.config/systemd/user/chattercatcher-gateway.service` 并打印 enable --now 指引（静态交付，未真机验证）。已有同名非本项目服务文件时拒绝覆盖。
- Docker 部署：新增根目录多阶段 `Dockerfile` 与 `.dockerignore`（排除 data/node_modules/.git/logs 等），`ENTRYPOINT ["node","dist/cli.js"]`，默认 `CHATTERCATCHER_HOME=/data`，一条 `docker build` + `docker run` 即可运行，镜像内不含密钥与用户数据。
- Web UI 设置页：支持在浏览器编辑配置（`GET/PUT /api/config`，白名单字段部分更新、密钥脱敏、secret 留空即不修改）、导出数据（`POST /api/export`，导出到 `storage.dataDir/exports/` 且不含密钥）与重建索引（调用 `/api/process/messages`，与 CLI `index rebuild` 同一条处理路径）。
- 语音转写：飞书语音自动转写为文字进入知识库，支持检索与引用。走 OpenAI-compatible 远程 `/audio/transcriptions` 端点（独立 `transcription` 配置段），转写文本 100% 来自模型返回，失败自动重试三次后标失败。
- 图片 OCR：`describeImage` 增加 `extractedText` 字段，图片中的文字原文提取后与转述摘要一起写入派生消息，图内文字可被检索。
- 文件解析新增三种格式：XLSX（支持共享字符串与多工作表，中文不乱码）、PPTX（按幻灯片顺序提取每页文字）、HTML/HTM（剥除 script/style/nav 等样板后提取正文）。

## [0.2.7] - 2026-05-30

### Added
- 个人档案（Personal Profiles）：自动从群聊消息中识别成员，建立以人物为中心的知识档案。每个成员拥有独立的 profile entries，按 category 分类，包含事实（fact）和推断（inferred）两种类型。
- Dream 处理器：周期性批量分析新消息，自动提取人物档案变化。Dream 只基于当前批次消息输出档案更新，带证据引用和置信度评分。
- 档案 RAG 工具：`get_person_profile` 和 `search_person_messages` 两个 Agent 工具，让问答系统可以检索人物档案并按人物搜索消息来辅助回答问题。
- 档案修正：支持通过 Web API 显式纠正或删除档案条目，用户可指定修正理由和证据。
- 档案 Web API：`GET /api/persons`、`GET /api/persons/:personId/profile`、`GET /api/persons/:personId/messages`、`POST /api/persons/:personId/profile/entries/:entryId/correct` 和 `DELETE /api/persons/:personId/profile/entries/:entryId` 等接口，Web UI 可展示和维护人物档案。
- 发布要求：`CHANGELOG.md` 纳入 npm 发布包，每次发版必须更新。

## [0.2.5] - 2026-05-27

### Added
- Web UI QA trace 详情页：展示推理过程、工具调用、证据和回答细节。

### Fixed
- 飞书消息使用 Markdown post 格式发送，修复纯文本兼容性问题。

## [0.2.2] - 2026-05-25

### Fixed
- 所有 LLM prompt 统一使用北京时间（Asia/Shanghai），修复 UTC 时间导致的日期偏差。

## [0.2.0] - 2026-05-24

### Added
- 飞书回复支持 Markdown 富文本格式。
- Web UI 重构为液态玻璃暗色主题。

## [0.1.32] - 2026-05-23

### Fixed
- 检测飞书富文本内容错误并自动降级。

## [0.1.31] - 2026-05-22

### Fixed
- 限制飞书富文本回退逻辑，避免格式错误。

## [0.1.27] - 2026-05-20

### Added
- 初始公开发布：本地飞书/Lark 家庭群 RAG 记忆机器人。
- 飞书长连接 Gateway。
- SQLite FTS5 + embedding 混合 RAG 检索。
- 会话记忆块（episode summary）。
- 群内自然语言定时任务。
- 文件知识源导入（txt/md/json/csv/tsv/log/docx/pdf）。
- 本地 Web UI。
- 相对时间归一化。
