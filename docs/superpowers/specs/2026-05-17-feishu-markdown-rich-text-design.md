# 飞书 Markdown 富文本发送设计

## 背景

当前飞书发送层使用 `msg_type: "text"` 发送所有文本消息。飞书普通文本不会渲染 Markdown，因此模型输出的标题、列表、加粗、链接和代码块会原样展示。目标是在不要求模型输出飞书 JSON 的前提下，让业务层继续产出 Markdown，由发送层统一转换成飞书富文本消息。

## 目标

- 所有飞书文本发送入口默认支持 Markdown 到飞书富文本的转换。
- 覆盖问答回复、定时任务文本和其他复用 `MessageSender` 的文本消息。
- 保留现有接口形状，尽量不改业务调用方。
- 发送富文本失败时自动降级为当前纯文本格式，避免消息丢失。
- 保留定时任务的 @ 人能力。

## 非目标

- 不实现完整 CommonMark 兼容解析器。
- 不让模型直接输出飞书 `post` JSON。
- 不改 Web UI 的 Markdown 渲染。
- 不改变图片发送流程。

## 方案

新增 `src/feishu/markdown-post.ts`，提供 Markdown 到飞书 `post` 内容的轻量转换。`src/feishu/sender.ts` 继续暴露 `sendTextToChat()` 和 `replyTextToMessage()`，但内部先构造 `msg_type: "post"` payload 并调用飞书 SDK；如果发送失败，再发送现有 `msg_type: "text"` payload。

转换器支持模型常见 Markdown 子集：段落、空行分段、`#` 标题、无序列表、有序列表、围栏代码块、链接和加粗。复杂语法按普通文本保留，保证可读性优先于完整格式还原。

## 数据流

1. 问答或定时任务生成 Markdown 字符串。
2. 调用现有 `sendTextToChat()` 或 `replyTextToMessage()`。
3. sender 调用 Markdown 转换器生成飞书 `post` content。
4. sender 使用 `msg_type: "post"` 发送。
5. 如果 SDK 抛错，sender 使用现有纯文本 payload 重试。

## @ 人处理

`SendTextOptions.mentions` 保持不变。富文本发送时，sender 在 `post.zh_cn.content` 开头插入飞书 `at` 元素；纯文本降级时继续使用当前 `<at user_id="...">name</at>` 前缀。

## 测试

- Markdown 转换器单测覆盖段落、标题、列表、代码块、链接、加粗和混合内容。
- sender 单测覆盖默认发送 `post`、富文本发送失败后降级为 `text`、富文本 @ 人元素。
- 现有问答和定时任务测试应不需要大规模改动，因为接口保持兼容。
- 完成后运行 `npm run build && npm test && npm run typecheck`。
