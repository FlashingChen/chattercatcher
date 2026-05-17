# Web UI 问答 Trace 详情设计

## 背景

ChatterCatcher 已经会把群聊问答写入 `qa_logs`，并在 Web UI 中展示问题、回答、状态、引用数量和创建时间。但现有记录主要面向最终结果，不足以解释一次回答为什么这样生成：模型每一轮说了什么、是否产生 reasoning、调用了哪些工具、工具输入输出是什么、检索证据是什么、是否触发 fallback，都无法在 Web UI 中完整追踪。

用户明确希望每次问答都保存模型思考过程和工具调用，并能在 Web UI 点击查看具体详情。该功能用于调试 RAG、排查飞书问答异常、理解工具调用链路，以及判断回答是否有可靠证据。

## 目标

- 每次群聊问答默认保存完整执行 trace。
- Web UI 的问答日志列表可以进入单条详情。
- 详情页展示完整模型执行链路，包括 reasoningContent、tool calls、tool results、错误和 fallback。
- 保留现有问答日志列表能力，不破坏近期对话上下文读取。
- 数据结构保持可演进，避免把所有调试信息继续塞进 `retrievalDebug`。

## 非目标

- 不做多用户登录或复杂权限系统。
- 不做 trace 的全文搜索或跨日志聚合统计。
- 不做 trace 编辑、删除或脱敏功能。
- 不隐藏 reasoningContent；用户选择全量存储并展示。
- 不重构整个 Web UI 技术栈。

## 方案

采用 `qa_logs.trace_json` 作为结构化扩展字段。每条问答日志仍是一条 `qa_logs` 记录，但新增 `trace_json TEXT NOT NULL DEFAULT '{}'`。列表接口只返回摘要和 `hasTrace`，详情接口返回完整 trace。

这个方案改动集中，能复用现有 `QaLogRepository`、Web UI 问答日志列表和数据库迁移方式；相比单独事件表，实现成本更低，也足够支撑当前“点击查看单条详情”的需求。

## 数据模型

### 数据库变更

`qa_logs` 增加字段：

```sql
ALTER TABLE qa_logs ADD COLUMN trace_json TEXT NOT NULL DEFAULT '{}';
```

迁移逻辑需要兼容已有数据库：启动时检查 `qa_logs` 是否已有 `trace_json`，没有则添加。

### TypeScript 类型

新增 trace 类型，放在 `src/rag/qa-logs.ts` 或独立文件 `src/rag/qa-trace.ts`。推荐独立文件，避免 repository 文件继续膨胀。

```ts
export interface QaTrace {
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  status?: "answered" | "failed";
  finalAnswer?: string;
  modelTurns?: QaTraceModelTurn[];
  toolResults?: QaTraceToolResult[];
  fallbacks?: QaTraceFallback[];
}

export interface QaTraceModelTurn {
  index: number;
  content: string;
  reasoningContent?: string;
  toolCalls: Array<{
    id: string;
    name: string;
    input: unknown;
  }>;
  createdAt: string;
}

export interface QaTraceToolResult {
  toolCallId: string;
  name: string;
  input: unknown;
  content?: string;
  error?: string;
  createdAt: string;
}

export interface QaTraceFallback {
  type: "raw_tool_markup" | "tool_limit" | "salvage_completion" | "answer_generation_failed";
  message: string;
  createdAt: string;
}
```

`QaLogRecord` 增加：

```ts
trace: QaTrace;
hasTrace: boolean;
```

`CreateQaLogInput` 增加：

```ts
trace?: QaTrace;
```

`hasTrace` 不必入库，可由 `trace_json !== '{}'` 或 trace 对象字段数量判断。

## 问答链路变更

### `runFeishuToolLoop()` 返回值

当前 `runFeishuToolLoop()` 返回 `Promise<string>`。改为返回：

```ts
interface FeishuToolLoopResult {
  answer: string;
  trace: QaTrace;
}
```

主流程中：

```ts
const result = await runFeishuToolLoop(...);
qaLogs.create({
  answer: result.answer,
  trace: result.trace,
  ...
});
await sendResponse(..., result.answer);
```

失败路径也要写 trace，至少包含：

- startedAt
- completedAt
- durationMs
- status: `failed`
- error fallback 或异常信息

### trace 采集点

在 `runFeishuToolLoop()` 中采集：

1. 函数开始时记录 `startedAt`。
2. 每次 `completeWithTools()` 返回后，追加 `modelTurns[]`：
   - turn index
   - assistant content
   - reasoningContent
   - toolCalls
   - createdAt
3. 每次工具执行成功后，追加 `toolResults[]`：
   - toolCallId
   - name
   - input
   - content
   - createdAt
4. 每次工具执行失败后，追加 `toolResults[]`：
   - toolCallId
   - name
   - input
   - error
   - createdAt
5. 遇到未知工具时，也按 tool result error 记录。
6. 遇到 raw tool markup、工具调用上限、salvage completion、最终回答生成失败时，追加 `fallbacks[]`。
7. 返回前写入 completedAt、durationMs、status、finalAnswer。

### 内容大小

当前不做截断，按用户要求全量保存 reasoning 和工具结果。后续如果数据库膨胀，再单独设计 trace retention 或压缩策略。

## Web API

### `GET /api/qa-logs?limit=20`

继续用于列表。返回每条日志时增加：

```json
{
  "id": "qa_xxx",
  "question": "...",
  "answer": "...",
  "status": "answered",
  "citations": [],
  "retrievalDebug": {},
  "hasTrace": true,
  "createdAt": "2026-05-17T10:00:00.000Z"
}
```

列表接口可以继续包含 `citations` 和 `retrievalDebug`，但不返回完整 `trace`，避免列表过重。

### `GET /api/qa-logs/:id`

新增详情接口。返回单条完整记录：

```json
{
  "id": "qa_xxx",
  "chatId": "oc_xxx",
  "questionMessageId": "om_xxx",
  "question": "...",
  "answer": "...",
  "citations": [],
  "retrievalDebug": {},
  "trace": {
    "startedAt": "...",
    "completedAt": "...",
    "durationMs": 1234,
    "status": "answered",
    "finalAnswer": "...",
    "modelTurns": [],
    "toolResults": [],
    "fallbacks": []
  },
  "status": "answered",
  "error": null,
  "createdAt": "2026-05-17T10:00:00.000Z"
}
```

错误：

- 找不到记录时返回 404：`{ ok: false, message: "没有找到问答日志。" }`

该接口是只读接口，不需要 Web action token。

## Web UI

### 问答日志列表

每条问答日志增加“查看详情”入口。列表中保留：

- 时间
- 状态
- 引用数量
- 问题
- 回答摘要
- 是否有 trace

点击“查看详情”时请求 `GET /api/qa-logs/:id`。

### 详情展示

详情区域可以用同页展开、侧边区域或弹层实现；本设计不限定视觉形式。功能内容必须包括：

- 基本信息：问题、答案、状态、错误、创建时间、耗时。
- Reasoning：展示每轮 `reasoningContent` 原文；没有时显示“无 reasoningContent”。
- 模型轮次：展示每轮 assistant content 和 tool calls。
- 工具结果：展示工具名、输入 JSON、输出文本或错误。
- 引用与检索：展示 citations 和 retrievalDebug。
- Fallback：展示 fallback 类型和说明。

所有动态内容都必须 HTML 转义，JSON 内容以文本方式展示。

### 空态与错误

- 没有 trace 时显示“这条问答没有 trace，可能来自旧版本记录”。
- 详情加载失败时显示错误信息。
- 404 时显示“没有找到问答日志”。

## 测试策略

### 数据库与 repository 测试

- 新数据库创建后 `qa_logs` 包含 `trace_json`。
- 旧数据库迁移后补齐 `trace_json`。
- `QaLogRepository.create()` 可以保存 trace。
- `listRecent()` 返回 `hasTrace`，但不要求前端使用完整 trace。
- `getById()` 返回完整 trace。

### Feishu 问答链路测试

- 模型无工具调用时，保存一轮 model turn 和 finalAnswer。
- 模型调用工具成功时，保存 tool call 和 tool result。
- 工具执行失败时，保存 tool result error。
- salvage completion 路径保存 fallback。
- handler 写入 qa_logs 时包含 trace。

### Web API 测试

- `GET /api/qa-logs` 返回 `hasTrace`。
- `GET /api/qa-logs/:id` 返回完整 trace。
- 不存在的 id 返回 404。

### Web UI 测试

- 首页包含问答详情入口。
- 点击详情入口会请求 `/api/qa-logs/:id`。
- 详情区域能展示 reasoning、tool calls、tool results、fallbacks。
- 动态内容不会通过 innerHTML 直接注入未转义文本。

## 风险与处理

### 数据量变大

全量 reasoning 和 tool output 会增大 SQLite 数据库。当前按用户要求全量保存，不做截断。后续如果出现数据库膨胀，再增加 retention、导出或压缩。

### 敏感信息

reasoning、工具输入输出和检索证据可能包含敏感内容。当前 Web UI 默认本地使用，且用户明确选择全量存储展示。后续如果要公网部署，需要重新设计权限和脱敏。

### 旧数据兼容

旧的 qa_logs 没有 trace。迁移后默认 `trace_json = '{}'`，Web UI 详情需要明确显示旧记录无 trace。
