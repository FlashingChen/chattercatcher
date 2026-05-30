<p align="center">
  <a href="https://github.com/FlashingChen2024/chattercatcher">
    <img src="./assets/chattercatcher-hero.svg" alt="ChatterCatcher" />
  </a>
</p>

<h1 align="center">ChatterCatcher</h1>

<p align="center">
  <img src="./assets/chattercatcher-logo.png" alt="ChatterCatcher logo" width="128" />
</p>

<p align="center">
  <strong>本地优先、证据驱动、面向飞书/Lark 家庭群的 RAG 记忆机器人。</strong>
</p>

<p align="center">
  静默保存家庭群里的重要消息、文件和碎片化上下文，被 @ 时用可追溯引用回答。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/chattercatcher"><img alt="npm" src="https://img.shields.io/npm/v/chattercatcher?style=for-the-badge&logo=npm" /></a>
  <a href="https://github.com/FlashingChen2024/chattercatcher"><img alt="GitHub stars" src="https://img.shields.io/github/stars/FlashingChen2024/chattercatcher?style=for-the-badge&logo=github" /></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/github/license/FlashingChen2024/chattercatcher?style=for-the-badge" /></a>
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6.x-3178c6?style=flat-square&logo=typescript&logoColor=white" />
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=node.js&logoColor=white" />
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-FTS5%20%2B%20vectors-003b57?style=flat-square&logo=sqlite&logoColor=white" />
  <img alt="Feishu" src="https://img.shields.io/badge/Feishu%20%2F%20Lark-MVP-3370ff?style=flat-square" />
</p>

---

## 加入交流群

<table>
  <tr>
    <td width="280" valign="top">
      <img src="./assets/readme/feishu-community-qr.png" alt="ChatterCatcher 飞书交流群二维码" width="260" />
    </td>
    <td valign="top">
      <h3>反馈、测试和共建</h3>
      <p>扫描左侧二维码加入 ChatterCatcher 飞书交流群。</p>
      <p>欢迎提交使用反馈、Bug、部署经验、飞书配置问题、RAG 行为建议和真实家庭群使用案例。</p>
      <p><strong>GitHub 仓库：</strong><a href="https://github.com/FlashingChen2024/chattercatcher">https://github.com/FlashingChen2024/chattercatcher</a></p>
    </td>
  </tr>
</table>

---

## 项目状态

ChatterCatcher 是一个早期 MVP。它已经具备飞书长连接接入、本地消息存储、SQLite FTS、SQLite embedding 向量检索、会话记忆块、OpenAI-compatible LLM/Embedding、CLI、本地 Web UI 和带引用回答。

近期亮点：

- **个人档案（Personal Profiles）**：自动识别群聊中的成员，为每个人建立独立的知识档案。档案条目按 category 分类，区分事实（fact）和推断（inferred），带置信度评分和证据引用。
- **Dream 处理器**：周期性批量分析新消息，自动提取人物档案变化。Dream 只基于当前批次消息输出更新，不回顾全部历史，保证处理效率。
- **无 native 向量库依赖**：语义向量写入 SQLite，避免 LanceDB 平台包在不同 macOS/CPU 架构上安装失败。
- **SQLite FTS + embedding 混合 RAG**：关键词和语义检索并行召回，回答前必须先找到本地证据。
- **相对时间归一化**：自动将"今天""明天""今晚"等相对时间表述转换为具体日期。所有 LLM 路径（会话摘要、RAG 问答、Agent 工具循环）统一注入当前时间并强调时间推导规则，让回答中的日期始终准确。
- **群内定时任务**：在群里用自然语言创建 cron 定时任务，支持"每天 9 点总结昨天群聊"等日常需求。创建、查看、删除都在群里一句话搞定，任务限定当前群聊不能跨群。
- **工具循环智能兜底**：当 Agent 多轮工具调用达到上限时，自动用对话历史生成最终答案，不再返回含混的"操作已提交"提示。
- **自动识别飞书机器人身份**：可通过 App ID / App Secret 自动获取 `botOpenId`，减少手动配置错误。
- **会话记忆块**：把 10 分钟窗口、静默 2 分钟后的碎片聊天整理成 episode summary，让"我要发一个 API key"与后续短消息保持上下文关联。
- **敏感摘要保护**：会话摘要会脱敏疑似 token/API key；原始消息仍保留在本地，方便必要时追溯。

当前核心方向是：

- 让家庭群信息自然沉淀为本地知识库，而不是靠手动整理。
- 所有事实性回答必须先检索 RAG 证据，不能把大量历史聊天直接塞给 LLM。
- `@` 机器人的提问不进入知识库，避免污染检索结果。
- 回答必须能追溯到"谁在什么时候说了什么"。
- 新信息覆盖旧信息时保留历史证据，并优先使用明确、更新的证据。
- 自动为群成员建立个人档案，让机器人了解"谁喜欢什么""谁需要什么"。
- 默认本地部署，Web UI 默认只监听 `127.0.0.1`。

---

## 项目预览

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="./assets/readme/preview-chat.svg" alt="Feishu message capture preview" />
      <br />
      <strong>飞书群消息捕获</strong>
      <br />
      普通群消息静默入库，保留发送人、群名、时间、原始平台元数据和文本内容。
    </td>
    <td width="50%" valign="top">
      <img src="./assets/readme/preview-rag.svg" alt="RAG retrieval preview" />
      <br />
      <strong>本地 RAG 检索</strong>
      <br />
      SQLite FTS 与 SQLite embedding 向量检索并存，回答前必须先召回证据。
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="./assets/readme/preview-answer.svg" alt="Cited answer preview" />
      <br />
      <strong>引用式回答</strong>
      <br />
      被 @ 后先即时反馈，再基于证据回复原消息，并输出可读来源。
    </td>
    <td width="50%" valign="top">
      <img src="./assets/readme/preview-web.svg" alt="Local Web UI preview" />
      <br />
      <strong>本地 Web UI</strong>
      <br />
      查看 Gateway 状态、最近消息、群聊、文件库、解析任务和人物档案。
    </td>
  </tr>
</table>

---

## 核心能力

| 模块 | 能力 |
| --- | --- |
| 飞书 Gateway | 官方长连接、`im.message.receive_v1` 事件、自动 `botOpenId` 获取、重复投递保护、附件下载入口 |
| 消息入库 | 普通文本消息写入 SQLite；`@` 提问直接回答并跳过入库 |
| 人物档案 | 自动识别群成员并建立以人物为中心的档案。支持事实/推断分类、置信度评分、证据追溯、Dream 自动更新、显式修正 |
| 会话记忆块 | 默认 10 分钟窗口 + 2 分钟静默期，把碎片聊天整理成可检索 episode summary，并关联原始消息 |
| RAG 检索 | SQLite FTS 关键词检索、SQLite embedding 向量检索、episode summary 检索、人物档案检索、混合重排、证据来源保留 |
| 时间归一化 | 自动将相对时间（今天/明天/今晚）推导为具体日期，覆盖会话摘要、RAG 问答、Agent 工具循环全部 LLM 路径 |
| 问答 | OpenAI-compatible chat completions、Agent 多轮工具调用、证据不足时说不知道、回答带引用、工具循环耗尽智能兜底 |
| 定时任务 | 群内自然语言创建 cron 定时任务（如"每天 9 点总结昨天群聊"），限定当前群聊，支持创建/查看/删除 |
| 引用格式 | 展示"谁在什么时候说了什么"，避免暴露 `ou_` / `oc_` 等 opaque id |
| 文件知识源 | 支持 txt、md、json、csv、tsv、log、docx、pdf 导入和解析 |
| CLI | setup、settings、doctor、gateway、process、index、files、export、restore、profiles |
| Web UI | 本地状态看板、自动刷新、最近消息、群聊、文件库、人物档案和解析任务 |
| 隐私 | 配置与密钥分离；导出不包含 API Key、App Secret 或 token；会话摘要会脱敏疑似密钥 |
| 数据管理 | 本地导出/恢复、按消息/文件/群删除本地知识库数据 |

---

## 个人档案（Personal Profiles）

ChatterCatcher 会自动识别群里的每个发言者，为他们建立个人档案。这不仅仅是记录"谁是谁"，更是让机器人理解群成员的偏好、需求和背景。

### 档案条目类型

- **事实（fact）**：从聊天中明确提取的事实信息，如"豆豆的编程课是每周六下午 2 点"。
- **推断（inferred）**：从聊天模式中推断的信息，如"豆豆喜欢编程"，置信度相对较低。

### 档案分类

每条档案条目属于一个 category，例如：
- `preference`：偏好（喜欢/不喜欢什么）
- `schedule`：日程（固定活动时间）
- `health`：健康相关信息
- `skill`：技能和特长
- `role`：家庭角色

### Dream 自动更新

Dream 处理器会定期运行，批量分析新的群聊消息，自动发现人物档案的新变化。它只基于最新的消息批次输出更新，带证据引用和置信度评分。没有足够证据时不会强行生成条目。

### 显式修正

用户可以通过 Web UI 或 API 显式纠正、删除档案条目，修正会记录理由和证据，保证档案的准确性和可追溯性。

---

## 架构概览

```mermaid
flowchart LR
  Feishu["飞书/Lark 群"] --> Gateway["本地 Gateway"]
  Gateway --> Router["消息路由"]

  Router -->|"普通消息"| SQLite["SQLite messages"]
  SQLite --> Episode["Episode summaries"]
  SQLite --> FTS["SQLite FTS5"]
  Episode --> EpisodeFTS["Episode FTS5"]
  SQLite --> Indexer["Embedding Indexer"]
  Indexer --> Vectors["SQLite embedding vectors"]
  SQLite --> Profiles["Personal Profiles"]
  Profiles --> Dream["Dream Processor"]

  Router -->|"@ 提问"| QA["Question Handler"]
  QA --> Hybrid["Hybrid Retriever"]
  FTS --> Hybrid
  EpisodeFTS --> Hybrid
  Vectors --> Hybrid
  Profiles --> Hybrid
  Hybrid --> LLM["OpenAI-compatible LLM"]
  LLM --> Reply["带引用回复原消息"]
  Reply --> Feishu

  CLI["CLI"] --> SQLite
  Web["Local Web UI"] --> SQLite
```

---

## 从零开始搭建

### 1. 环境要求

- Node.js 20 或更高
- npm 10 或更高
- 一个飞书/Lark 自建应用
- 一个 OpenAI-compatible LLM API Key
- 一个 OpenAI-compatible Embedding API Key，或复用 LLM API Key

### 2. 安装

```bash
npm install -g chattercatcher
```

检查 CLI：

```bash
chattercatcher --help
```

### 3. 创建飞书应用

1. 打开 [飞书应用创建入口](https://open.feishu.cn/page/launcher)，创建一个自建应用。
2. 在飞书开发者后台开通机器人能力。
3. 把机器人加入目标家庭群。
4. 在事件订阅里选择长连接模式。
5. 订阅 `im.message.receive_v1`。
6. 记录 App ID 和 App Secret。

### 4. 配置 ChatterCatcher

```bash
chattercatcher setup
```

`setup` 会写入：

| 配置项 | 说明 |
| --- | --- |
| 飞书 App ID | 普通配置 |
| 飞书 App Secret | 写入 `secrets.json` |
| LLM Base URL | OpenAI-compatible chat completions endpoint |
| LLM API Key | 写入 `secrets.json` |
| LLM Model | 用于答案生成 |
| Embedding Base URL | 可复用 LLM Base URL |
| Embedding API Key | 留空可复用 LLM API Key |
| Embedding Model | 用于 SQLite embedding 语义检索 |
| Web UI Host/Port | 默认 `127.0.0.1:3878` |

### 5. 检查配置

```bash
chattercatcher doctor --online
```

### 6. 启动 Gateway 和 Web UI

```bash
chattercatcher gateway start
```

默认 Web UI：

```text
http://127.0.0.1:3878
```

---

## 使用方式

普通群消息会静默进入知识库：

```text
编程课的时间改成了后天13:40
```

提问时在群里 @ 机器人：

```text
@小陈 最近一次编程课是什么时候
```

机器人会先即时反馈，再基于本地证据回答。提问本身不会入库。

期望回答类似：

```text
最近一次编程课是 2026-04-28 13:40 [S1]。

引用：
[S1] 群成员在 2026-04-26 13:36 说："编程课的时间改成了后天13:40"
```

注意：原文说的是"后天"，但 ChatterCatcher 已根据消息时间戳自动推导为具体日期。

---

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `chattercatcher setup` | 交互式初始化配置 |
| `chattercatcher settings show` | 查看脱敏配置 |
| `chattercatcher doctor --online` | 检查本地配置、存储和在线连通性 |
| `chattercatcher gateway start` | 启动飞书长连接 Gateway 和本地 Web UI |
| `chattercatcher gateway status` | 查看 Gateway 状态 |
| `chattercatcher gateway stop` | 停止 Gateway |
| `chattercatcher process messages` | 立即处理消息索引任务 |
| `chattercatcher process episodes` | 立即生成会话记忆块，把碎片聊天整理成可检索摘要 |
| `chattercatcher index rebuild` | 重建 SQLite embedding 向量索引 |
| `chattercatcher files add <path...>` | 导入本地文件知识源 |
| `chattercatcher files jobs` | 查看文件解析任务 |
| `chattercatcher export --out <file>` | 导出本地知识库数据，不含密钥 |
| `chattercatcher restore <file>` | 从导出文件恢复 |
| `chattercatcher cron list` | 列出所有定时任务 |
| `chattercatcher cron run` | 手动触发到期定时任务 |
| `chattercatcher profiles list` | 列出所有人物档案 |
| `chattercatcher profiles show <personId>` | 查看指定人物档案详情 |

---

## 会话记忆块

家庭群聊天经常是碎片化的：前一句说明背景，后一句只发一个短词、链接或密钥。只检索单条原始消息时，RAG 很容易丢失上下文。

ChatterCatcher 会在普通消息入库后尝试生成 **会话记忆块（episode summary）**：

1. 按群聊读取尚未整理过的原始消息。
2. 默认以 10 分钟为窗口聚合相邻聊天。
3. 当窗口最后一条消息之后安静 2 分钟，认为这一小段对话可以整理。
4. 调用 LLM 把碎片聊天总结成可检索事实。
5. 将摘要写入本地 SQLite，并记录它关联的原始消息 ID。
6. 问答时同时检索原始消息、文件证据、会话记忆块和人物档案。

会话摘要会脱敏疑似 API key、token、cookie、私钥和 URL 凭据；原始消息仍保存在本地数据库里，回答需要追溯时可以回到原始证据。

手动触发：

```bash
chattercatcher process episodes
```

---

## 群内定时任务

在群里用自然语言即可创建定时任务。ChatterCatcher 会把自然语言时间描述自动转换为 cron 表达式：

```text
@小陈 每天 9 点总结昨天群聊
@小陈 每周一上午 10 点提醒大家报备周末计划
@小陈 查看定时任务
@小陈 删除 job-abc123
```

定时任务限定在当前群聊内，不能跨群查看或操作其他群的任务。

CLI 管理：

```bash
chattercatcher cron list          # 查看所有定时任务
chattercatcher cron run           # 手动触发到期任务
```

---

## 本地数据目录

默认数据目录：

```text
~/.chattercatcher/
|-- config.json
|-- secrets.json
`-- data/
    |-- chattercatcher.db
    |-- files/
    `-- exports/
```

这些内容不应该提交到 GitHub：

```text
config/
data/
.env
node_modules/
dist/
```

---

## 隐私与安全

- 默认本地部署。
- 默认 Web UI 只监听 `127.0.0.1`。
- 聊天记录、文件内容、OCR 结果和语音转写都视为隐私数据。
- App Secret、API Key 和 token 与普通配置分开保存。
- 会话记忆块会脱敏疑似 API key、token、cookie、私钥和 URL 凭据，避免把敏感值扩散到摘要里。
- 人物档案条目同样遵守隐私原则，只从本地已保存的消息中提取，不会另建远程档案。
- 原始消息仍保存在本地数据库，方便在必要时追溯上下文。
- 导出文件不包含密钥。
- 事实性回答必须基于检索证据。
- 检索不到证据时必须说不知道。

---

## 本地开发

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

运行开发版 CLI：

```bash
npm run dev -- --help
```

---

## 常见问题

### `@` 机器人的问题会进知识库吗？

不会。`@` 提问是查询意图，不是家庭事实。ChatterCatcher 会直接回答并跳过入库，避免污染 RAG。

### 人物档案和 RAG 是什么关系？

人物档案是 RAG 的一种证据来源。回答问题时，检索器会同时检索原始消息、文件、会话记忆块和人物档案。例如问"豆豆喜欢什么"，机器人可能从消息中找到直接回答，也可能从档案中找到汇总的偏好条目。

### Dream 处理器是什么？

Dream 是人物档案的自动更新机制。它会定期读取新消息，用 LLM 分析这些消息中是否包含人物信息的变化，并自动写入或更新档案条目。Dream 只基于当前批次的消息，不回看全部历史，保证效率和增量更新。

### 没有 embedding 能用吗？

可以保留 SQLite FTS 关键词检索，但语义检索需要配置 embedding。建议运行 `chattercatcher doctor --online` 确认维度和连通性。

### macOS 上提示 `Cannot find native binding` 怎么办？

请升级到移除平台 native 向量库依赖的版本：

```bash
npm install -g chattercatcher@latest
```

当前版本的语义向量索引写入 SQLite，不再依赖平台相关的 native optional dependency。

### 为什么要用 RAG？

家庭聊天是长期知识库，不应该靠把全部历史消息塞进上下文。RAG 可以控制证据范围、保留来源、降低幻觉，并让回答可追溯。

### 会话记忆块是什么？

会话记忆块是 ChatterCatcher 对一小段碎片聊天生成的本地摘要。它默认等待 10 分钟窗口结束并静默 2 分钟后生成，用来保留"上一句解释背景、下一句只发短内容"的上下文关系。可以运行 `chattercatcher process episodes` 手动触发。

### 会话摘要会不会泄露 API key？

摘要层会脱敏疑似 API key、token、cookie、私钥和 URL 凭据；原始消息仍然只保存在本地数据库，用于必要时追溯证据。

### ChatterCatcher 能理解"明天""今晚"这种相对时间吗？

可以。ChatterCatcher 会自动识别消息的时间戳，将"今天""明天""今晚""下周三"等相对表述推导为具体日期写入摘要和回答。你不需要在每次提问时手工推算日期。

### 定时任务怎么用？会不会跨群操作？

在群里 @ 机器人说"每天 9 点总结昨天群聊"即可创建定时任务。用"查看定时任务"列出当前群的任务，"删除 xxx"删掉指定任务。定时任务限定在当前群聊，不会跨群查看或操作。

### Web UI 可以暴露到公网吗？

默认不建议。ChatterCatcher 面向家庭隐私数据，默认只监听 `127.0.0.1`。

---

## License

This project is licensed under the [MIT License](./LICENSE).
