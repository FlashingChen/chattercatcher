# ChatterCatcher 产品需求文档

## 概述

ChatterCatcher 是一个本地优先的飞书/Lark 家庭群机器人。它静默监听群聊，保存消息和文件，构建可检索的本地知识库，并在被 `@` 时基于证据回答问题。

核心承诺：

```text
把机器人拉进家庭群。它记住群里的重要聊天和文件。之后直接问它，它用来源回答。
```

## 问题

家庭里的重要信息经常以闲聊形式发布：

- 活动日期。
- 学校或出行安排。
- 账单和付款信息。
- 文档。
- 截图。
- 语音消息。
- 链接。
- 后续变更。

大家经常忘记信息在哪里，只能去问某个最会找消息的人。这低效、重复，而且容易烦。

## 目标

- 无需手动打标签，也能捕获家庭群信息。
- 支持文字、文件、图片、链接、语音和飞书文档链接。
- 默认所有数据本地保存。
- 使用 LLM 理解、回答、摘要和处理信息冲突。
- 使用 embedding 和 RAG，让回答基于可追溯证据。
- 用户 `@ChatterCatcher` 后，机器人给出简短直接回答。
- 每个事实性回答都提供引用来源。
- 新信息覆盖旧信息时保留历史证据。
- 提供交互式 CLI 和基础本地 Web UI。

## 非目标

- ChatterCatcher 不是自主 Agent。
- 不执行任意外部任务。
- MVP 不做多租户 SaaS。
- MVP 不做飞书以外的平台。
- MVP 不需要公网访问。
- 第一版不做企业级复杂权限系统。

## 目标用户

主要维护者：

- 家里一个懂技术的人，负责安装、配置和维护。

最终用户：

- 飞书/Lark 家庭群成员，通过 `@机器人 + 问题` 使用。

## 核心用户故事

### 静默捕获

作为家庭成员，我希望机器人静默保存群里的消息和文件，这样不用手动整理。

验收标准：

- 机器人加入群后能接收飞书群消息。
- 机器人保存文字消息、发送人、群、时间戳和原始平台元数据。
- 机器人下载支持的媒体和文件到本地。
- 默认不主动回复，除非被 `@` 或用户显式配置。

### 问答

作为家庭成员，我希望直接 `@机器人` 提问，快速找到信息。

验收标准：

- `@ChatterCatcher 问题` 触发检索和回答。
- 回答简短直接。
- 回答包含来源引用。
- 证据不足时，机器人明确说不知道。

### 文件理解

作为家庭成员，我希望文件也能像聊天消息一样被检索和问答。

验收标准：

- PDF、Word、Excel、PowerPoint、文本、Markdown、图片、链接、语音和飞书文档链接被捕获。
- 解析后的文本会被切块、embedding、索引，并关联回源文件。
- 回答能引用文件名，以及可用的页码、sheet 或 slide。

### 冲突处理

作为家庭成员，我希望机器人优先使用较新的确定信息，但不把闲聊讨论误判为更新。

验收标准：

- 明确更新会覆盖同一主体、同一谓词的旧事实。
- 猜测、建议、讨论不会自动覆盖已确认事实。
- 机器人能在必要时说明旧信息已经被新信息取代。

示例：

```text
旧信息：活动 2026/5/30 举办。
新信息：活动改到 2026/6/30。
回答：活动目前是 2026/6/30。此前 2026/5/30 是旧信息。
```

### 引导式配置

作为维护者，我希望 `npm install -g chattercatcher` 后通过交互式命令完成配置。

验收标准：

- `chattercatcher setup` 引导配置飞书、模型、embedding、存储、定时任务和 Web UI。
- `chattercatcher settings` 可以修改和重置配置。
- `chattercatcher doctor` 检查飞书凭证、模型连通性、embedding 兼容性和本地存储。

### 个人档案

作为家庭成员，我希望机器人自动了解群成员的偏好、需求和背景，不用每次提问都从头解释。

验收标准：

- 机器人自动从消息中识别群成员，为每个人建立独立档案。
- 档案条目分事实（fact）和推断（inferred），带置信度评分。
- 档案按 category 分类（preference、schedule、health、skill 等）。
- Dream 处理器周期性批量分析新消息，自动更新档案。
- 用户可通过 Web UI 或 API 显式纠正档案条目。
- 档案条目可追溯原始证据（哪条消息、谁说、说什么）。
- 档案检索作为 RAG 证据源之一参与问答。

## RAG 要求

RAG 是产品核心，不是可选增强。

问答必须经过：

```text
问题理解 -> 混合检索 -> 证据重排 -> 冲突处理 -> 答案生成 -> 引用输出
```

禁止：

- 把全量聊天历史直接塞进 prompt。
- 把大文件全文直接塞进 prompt。
- 用上下文窗口替代向量索引和关键词索引。
- 没有引用地给出事实性答案。

## MVP 范围

MVP 必须包含：

- npm 全局包。
- 交互式 CLI。
- 飞书/Lark 自建应用连接。
- 基于飞书长连接的本地 Gateway。
- 本地存储。
- 文字消息捕获。
- 针对已捕获消息的 RAG。
- OpenAI-compatible chat model。
- OpenAI-compatible embedding model。
- `@机器人` 触发问答。
- 来源引用。
- 基础冲突处理。
- 基础本地 Web UI。

MVP 暂缓：

- 深度飞书云文档同步。
- 高级权限系统。
- 多平台支持。
- 云部署。
- 复杂自主工作流。

## 产品命令

必需 CLI 命令：

```bash
chattercatcher setup
chattercatcher settings
chattercatcher settings reset
chattercatcher gateway start
chattercatcher gateway stop
chattercatcher gateway restart
chattercatcher gateway status
chattercatcher logs
chattercatcher logs --follow
chattercatcher index status
chattercatcher index rebuild
chattercatcher web start
chattercatcher doctor
chattercatcher export
```

## Web UI 要求

本地 Web UI 需要提供：

- Gateway 状态。
- 飞书连接状态。
- LLM 和 embedding 配置状态。
- 最近群消息。
- 群聊历史。
- 文件库。
- 索引任务。
- 问答日志。
- 配置编辑。
- 重建索引和导出数据。

默认监听地址：

```text
127.0.0.1
```

## 隐私要求

- 默认本地保存数据。
- Web UI 默认不对公网暴露。
- secrets 和普通配置分开保存。
- 不记录 secrets。
- 后续需要支持删除群、消息和文件数据。

## 飞书/Lark 集成

MVP 集成模式：

- 用户创建飞书/Lark 自建应用。
- 用户启用机器人能力。
- 用户配置所需权限。
- 用户启用长连接事件订阅。
- 用户订阅消息接收事件。
- ChatterCatcher Gateway 通过飞书/Lark SDK 在本地建立长连接。

设计参考 OpenClaw 的 Gateway 模式：本地 Gateway、App ID/App Secret 配置、长连接事件投递、群内 `@` 触发、CLI 可查看状态。

## 成功指标

家庭 MVP 的成功指标：

- 一个懂技术的用户能在 30 分钟内完成安装配置。
- 对近期聊天中的直接事实问题，至少 80% 能带引用回答。
- 没有证据时不会自信胡说。
- Gateway 能连续运行多天。
- parser 或 embedding 失败后能通过重建索引恢复。
