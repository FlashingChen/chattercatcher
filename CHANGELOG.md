# Changelog

## [0.2.6] - 2026-05-29

### Added
- 个人档案（Personal Profiles）：自动从群聊消息中识别成员，建立以人物为中心的知识档案。每个成员拥有独立的 profile entries，按 category 分类，包含事实（fact）和推断（inferred）两种类型。
- Dream 处理器：周期性批量分析新消息，自动提取人物档案变化。Dream 只基于当前批次消息输出档案更新，带证据引用和置信度评分。
- 档案 RAG 工具：`get_person_profile` 和 `list_person_profiles` 两个 Agent 工具，让问答系统可以检索人物档案来辅助回答问题。
- 档案修正：支持通过 `correction` 类型显式纠正档案条目，用户可指定修正理由和证据。
- 档案 Web API：`GET /api/profiles`、`GET /api/profiles/:personId`、`POST /api/profiles/:personId/correct` 等接口，Web UI 可展示和管理人物档案。
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
