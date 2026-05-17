# 飞书 Markdown 富文本发送 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让所有飞书文本发送入口把业务层 Markdown 自动转换为飞书 `post` 富文本，并在失败时降级为纯文本。

**Architecture:** 新增 `src/feishu/markdown-post.ts` 作为轻量 Markdown 到飞书 post 转换器；`src/feishu/sender.ts` 保留现有 `sendTextToChat()` / `replyTextToMessage()` 接口，但内部优先发送 `msg_type: "post"`。调用方无需改造，问答回复、定时任务和其他文本发送入口自动覆盖。

**Tech Stack:** TypeScript ESM, Vitest, Feishu/Lark OpenAPI message `text` and `post` payloads, existing `@larksuiteoapi/node-sdk` client wrapper.

---

## File Structure

- Create `src/feishu/markdown-post.ts`  
  负责定义飞书 post 内容类型、Markdown 轻量解析、mention 转 post `at` 元素、纯文本 fallback 使用的 mention 前缀格式。

- Create `tests/feishu/markdown-post.test.ts`  
  覆盖 Markdown 转换器的段落、标题、列表、代码块、链接、加粗、@ 人和混合内容行为。

- Modify `src/feishu/sender.ts`  
  使用转换器生成 `post` payload，发送失败时回退现有 `text` payload；回复消息和群消息都走同一策略。

- Modify `tests/feishu/sender.test.ts`  
  更新默认发送格式为 `post`，补充富文本失败降级、回复消息富文本、@ 人富文本测试。

---

### Task 1: Markdown 转飞书 post 转换器

**Files:**
- Create: `src/feishu/markdown-post.ts`
- Test: `tests/feishu/markdown-post.test.ts`

- [ ] **Step 1: Write failing tests for Markdown conversion**

Create `tests/feishu/markdown-post.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildFeishuPostContent, formatTextWithMentions } from "../../src/feishu/markdown-post.js";

describe("buildFeishuPostContent", () => {
  it("converts paragraphs and headings into Feishu post content", () => {
    expect(buildFeishuPostContent("# 标题\n\n第一段\n第二段")).toEqual({
      post: {
        zh_cn: {
          title: "",
          content: [
            [{ tag: "text", text: "标题", style: ["bold"] }],
            [{ tag: "text", text: "第一段\n第二段" }],
          ],
        },
      },
    });
  });

  it("converts unordered and ordered lists into readable post lines", () => {
    expect(buildFeishuPostContent("- 苹果\n- 香蕉\n\n1. 出门\n2. 回家")).toEqual({
      post: {
        zh_cn: {
          title: "",
          content: [
            [{ tag: "text", text: "• 苹果" }],
            [{ tag: "text", text: "• 香蕉" }],
            [{ tag: "text", text: "1. 出门" }],
            [{ tag: "text", text: "2. 回家" }],
          ],
        },
      },
    });
  });

  it("keeps fenced code blocks readable", () => {
    expect(buildFeishuPostContent("说明\n\n```ts\nconst a = 1;\n```" )).toEqual({
      post: {
        zh_cn: {
          title: "",
          content: [
            [{ tag: "text", text: "说明" }],
            [{ tag: "text", text: "```\nconst a = 1;\n```" }],
          ],
        },
      },
    });
  });

  it("converts links and bold spans inside a paragraph", () => {
    expect(buildFeishuPostContent("请看 [文档](https://example.com) 和 **重点**")).toEqual({
      post: {
        zh_cn: {
          title: "",
          content: [
            [
              { tag: "text", text: "请看 " },
              { tag: "a", text: "文档", href: "https://example.com" },
              { tag: "text", text: " 和 " },
              { tag: "text", text: "重点", style: ["bold"] },
            ],
          ],
        },
      },
    });
  });

  it("prepends mention elements when provided", () => {
    expect(buildFeishuPostContent("记得带水杯", { mentions: [{ openId: "ou_mom", name: "妈妈" }] })).toEqual({
      post: {
        zh_cn: {
          title: "",
          content: [
            [
              { tag: "at", user_id: "ou_mom", user_name: "妈妈" },
              { tag: "text", text: " 记得带水杯" },
            ],
          ],
        },
      },
    });
  });
});

describe("formatTextWithMentions", () => {
  it("keeps the existing plain-text mention fallback", () => {
    expect(formatTextWithMentions("记得带水杯", { mentions: [{ openId: "ou_mom", name: "妈妈" }] })).toBe(
      '<at user_id="ou_mom">妈妈</at> 记得带水杯',
    );
  });
});
```

- [ ] **Step 2: Run converter tests and verify they fail**

Run:

```bash
npm test -- tests/feishu/markdown-post.test.ts
```

Expected: FAIL because `src/feishu/markdown-post.ts` does not exist.

- [ ] **Step 3: Implement the converter**

Create `src/feishu/markdown-post.ts`:

```ts
export interface FeishuTextMention {
  openId: string;
  name: string;
}

export interface SendTextOptions {
  mentions?: FeishuTextMention[];
}

interface FeishuPostTextElement {
  tag: "text";
  text: string;
  style?: string[];
}

interface FeishuPostLinkElement {
  tag: "a";
  text: string;
  href: string;
}

interface FeishuPostAtElement {
  tag: "at";
  user_id: string;
  user_name: string;
}

type FeishuPostElement = FeishuPostTextElement | FeishuPostLinkElement | FeishuPostAtElement;

export interface FeishuPostContent {
  post: {
    zh_cn: {
      title: string;
      content: FeishuPostElement[][];
    };
  };
}

function escapeAtText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function formatTextWithMentions(text: string, options?: SendTextOptions): string {
  const mentions = options?.mentions ?? [];
  if (mentions.length === 0) return text;
  const prefix = mentions
    .map((mention) => `<at user_id="${escapeAtText(mention.openId)}">${escapeAtText(mention.name)}</at>`)
    .join(" ");
  return `${prefix} ${text}`.trim();
}

function parseInline(text: string): FeishuPostElement[] {
  const elements: FeishuPostElement[] = [];
  const pattern = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\*\*([^*]+)\*\*)|(__([^_]+)__)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    if (match.index > lastIndex) {
      elements.push({ tag: "text", text: text.slice(lastIndex, match.index) });
    }

    if (match[2] && match[3]) {
      elements.push({ tag: "a", text: match[2], href: match[3] });
    } else {
      elements.push({ tag: "text", text: match[5] ?? match[7] ?? "", style: ["bold"] });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    elements.push({ tag: "text", text: text.slice(lastIndex) });
  }

  return elements.length ? elements : [{ tag: "text", text }];
}

function pushParagraph(content: FeishuPostElement[][], lines: string[]): void {
  if (lines.length === 0) return;
  content.push(parseInline(lines.join("\n")));
  lines.length = 0;
}

function parseMarkdownBlocks(markdown: string): FeishuPostElement[][] {
  const content: FeishuPostElement[][] = [];
  const paragraph: string[] = [];
  const code: string[] = [];
  let inCodeBlock = false;

  for (const rawLine of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();

    if (line.startsWith("```")) {
      if (inCodeBlock) {
        content.push([{ tag: "text", text: `\`\`\`\n${code.join("\n")}\n\`\`\`` }]);
        code.length = 0;
        inCodeBlock = false;
      } else {
        pushParagraph(content, paragraph);
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      code.push(rawLine);
      continue;
    }

    if (!line.trim()) {
      pushParagraph(content, paragraph);
      continue;
    }

    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      pushParagraph(content, paragraph);
      content.push([{ tag: "text", text: heading[1], style: ["bold"] }]);
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      pushParagraph(content, paragraph);
      content.push(parseInline(`• ${unordered[1]}`));
      continue;
    }

    const ordered = line.match(/^(\d+)\.\s+(.+)$/);
    if (ordered) {
      pushParagraph(content, paragraph);
      content.push(parseInline(`${ordered[1]}. ${ordered[2]}`));
      continue;
    }

    paragraph.push(line);
  }

  if (inCodeBlock) {
    content.push([{ tag: "text", text: `\`\`\`\n${code.join("\n")}` }]);
  }
  pushParagraph(content, paragraph);

  return content.length ? content : [[{ tag: "text", text: markdown }]];
}

export function buildFeishuPostContent(markdown: string, options?: SendTextOptions): FeishuPostContent {
  const content = parseMarkdownBlocks(markdown);
  const mentions = options?.mentions ?? [];

  if (mentions.length) {
    const mentionElements: FeishuPostElement[] = mentions.map((mention) => ({
      tag: "at",
      user_id: mention.openId,
      user_name: mention.name,
    }));
    const firstLine = content[0] ?? [];
    content[0] = [...mentionElements, { tag: "text", text: " " }, ...firstLine];
  }

  return {
    post: {
      zh_cn: {
        title: "",
        content,
      },
    },
  };
}
```

- [ ] **Step 4: Run converter tests and verify they pass**

Run:

```bash
npm test -- tests/feishu/markdown-post.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit converter**

Run:

```bash
git add src/feishu/markdown-post.ts tests/feishu/markdown-post.test.ts
git commit -m "feat: convert Markdown to Feishu post content"
```

---

### Task 2: Sender 默认发送富文本并降级纯文本

**Files:**
- Modify: `src/feishu/sender.ts:4-221`
- Modify: `tests/feishu/sender.test.ts:1-162`

- [ ] **Step 1: Update sender tests for rich text behavior**

Modify `tests/feishu/sender.test.ts` to expect `post` by default and fallback on failure:

```ts
import { describe, expect, it } from "vitest";
import { FeishuMessageSender } from "../../src/feishu/sender.js";

describe("FeishuMessageSender", () => {
  it("通过飞书 im.v1.message.create 发送 Markdown 富文本消息", async () => {
    const calls: unknown[] = [];
    const sender = new FeishuMessageSender({
      im: {
        v1: {
          message: {
            async create(payload) {
              calls.push(payload);
            },
          },
        },
      },
    });

    await sender.sendTextToChat("oc_family", "# 回答\n\n请看 **重点**");

    expect(calls).toEqual([
      {
        data: {
          receive_id: "oc_family",
          msg_type: "post",
          content: JSON.stringify({
            post: {
              zh_cn: {
                title: "",
                content: [
                  [{ tag: "text", text: "回答", style: ["bold"] }],
                  [
                    { tag: "text", text: "请看 " },
                    { tag: "text", text: "重点", style: ["bold"] },
                  ],
                ],
              },
            },
          }),
        },
        params: {
          receive_id_type: "chat_id",
        },
      },
    ]);
  });

  it("sends rich text messages with explicit Feishu mentions", async () => {
    const calls: unknown[] = [];
    const sender = new FeishuMessageSender({
      im: {
        v1: {
          message: {
            async create(payload) {
              calls.push(payload);
            },
          },
        },
      },
    });

    await sender.sendTextToChat("oc_family", "记得带水杯", {
      mentions: [{ openId: "ou_mom", name: "妈妈" }],
    });

    expect(calls).toEqual([
      {
        data: {
          receive_id: "oc_family",
          msg_type: "post",
          content: JSON.stringify({
            post: {
              zh_cn: {
                title: "",
                content: [
                  [
                    { tag: "at", user_id: "ou_mom", user_name: "妈妈" },
                    { tag: "text", text: " 记得带水杯" },
                  ],
                ],
              },
            },
          }),
        },
        params: {
          receive_id_type: "chat_id",
        },
      },
    ]);
  });

  it("falls back to plain text when rich text sending fails", async () => {
    const calls: unknown[] = [];
    const sender = new FeishuMessageSender({
      im: {
        v1: {
          message: {
            async create(payload) {
              calls.push(payload);
              if ((payload as { data: { msg_type: string } }).data.msg_type === "post") {
                throw new Error("post unsupported");
              }
            },
          },
        },
      },
    });

    await sender.sendTextToChat("oc_family", "**回答**", {
      mentions: [{ openId: "ou_mom", name: "妈妈" }],
    });

    expect(calls).toEqual([
      {
        data: {
          receive_id: "oc_family",
          msg_type: "post",
          content: JSON.stringify({
            post: {
              zh_cn: {
                title: "",
                content: [
                  [
                    { tag: "at", user_id: "ou_mom", user_name: "妈妈" },
                    { tag: "text", text: " " },
                    { tag: "text", text: "回答", style: ["bold"] },
                  ],
                ],
              },
            },
          }),
        },
        params: {
          receive_id_type: "chat_id",
        },
      },
      {
        data: {
          receive_id: "oc_family",
          msg_type: "text",
          content: JSON.stringify({ text: '<at user_id="ou_mom">妈妈</at> **回答**' }),
        },
        params: {
          receive_id_type: "chat_id",
        },
      },
    ]);
  });

  it("优先支持用富文本回复指定飞书消息", async () => {
    const calls: unknown[] = [];
    const sender = new FeishuMessageSender({
      im: {
        message: {
          async create() {
            throw new Error("should not call create");
          },
          async reply(payload) {
            calls.push(payload);
          },
        },
      },
    });

    await sender.replyTextToMessage("om_question", "# 回答");

    expect(calls).toEqual([
      {
        path: {
          message_id: "om_question",
        },
        data: {
          msg_type: "post",
          content: JSON.stringify({
            post: {
              zh_cn: {
                title: "",
                content: [[{ tag: "text", text: "回答", style: ["bold"] }]],
              },
            },
          }),
        },
      },
    ]);
  });

  it("回复富文本失败时降级为纯文本回复", async () => {
    const calls: unknown[] = [];
    const sender = new FeishuMessageSender({
      im: {
        v1: {
          message: {
            async create() {
              throw new Error("should not call create");
            },
            async reply(payload) {
              calls.push(payload);
              if ((payload as { data: { msg_type: string } }).data.msg_type === "post") {
                throw new Error("post unsupported");
              }
            },
          },
        },
      },
    });

    await sender.replyTextToMessage("om_question", "**回答**");

    expect(calls).toEqual([
      {
        path: {
          message_id: "om_question",
        },
        data: {
          msg_type: "post",
          content: JSON.stringify({
            post: {
              zh_cn: {
                title: "",
                content: [[{ tag: "text", text: "回答", style: ["bold"] }]],
              },
            },
          }),
        },
      },
      {
        path: {
          message_id: "om_question",
        },
        data: {
          msg_type: "text",
          content: JSON.stringify({ text: "**回答**" }),
        },
      },
    ]);
  });

  it("可以给指定消息添加表情回复", async () => {
    const calls: unknown[] = [];
    const sender = new FeishuMessageSender({
      im: {
        v1: {
          message: {
            async create() {
              throw new Error("should not call create");
            },
          },
          messageReaction: {
            async create(payload) {
              calls.push(payload);
            },
          },
        },
      },
    });

    await sender.addReactionToMessage("om_question", "OK");

    expect(calls).toEqual([
      {
        path: {
          message_id: "om_question",
        },
        data: {
          reaction_type: {
            emoji_type: "OK",
          },
        },
      },
    ]);
  });
});
```

- [ ] **Step 2: Run sender tests and verify they fail**

Run:

```bash
npm test -- tests/feishu/sender.test.ts
```

Expected: FAIL because `sender.ts` still sends `msg_type: "text"` first.

- [ ] **Step 3: Update sender implementation**

Modify `src/feishu/sender.ts`:

```ts
import * as lark from "@larksuiteoapi/node-sdk";
import fs from "node:fs/promises";
import type { AppConfig, AppSecrets } from "../config/schema.js";
import { buildFeishuPostContent, formatTextWithMentions } from "./markdown-post.js";
import type { FeishuTextMention, SendTextOptions } from "./markdown-post.js";

export type { FeishuTextMention, SendTextOptions } from "./markdown-post.js";

export interface MessageSender {
  sendTextToChat(chatId: string, text: string, options?: SendTextOptions): Promise<void>;
  sendImageToChat?(chatId: string, imagePath: string): Promise<void>;
  replyTextToMessage?(messageId: string, text: string): Promise<void>;
  addReactionToMessage?(messageId: string, emojiType: string): Promise<void>;
}
```

Replace `sendTextToChat` with:

```ts
  async sendTextToChat(chatId: string, text: string, options?: SendTextOptions): Promise<void> {
    const postPayload = {
      data: {
        receive_id: chatId,
        msg_type: "post",
        content: JSON.stringify(buildFeishuPostContent(text, options)),
      },
      params: {
        receive_id_type: "chat_id" as const,
      },
    };
    const textPayload = {
      data: {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text: formatTextWithMentions(text, options) }),
      },
      params: {
        receive_id_type: "chat_id" as const,
      },
    };

    if (this.client.im.v1?.message.create) {
      try {
        await this.client.im.v1.message.create(postPayload);
        return;
      } catch {
        await this.client.im.v1.message.create(textPayload);
        return;
      }
    }

    if (this.client.im.message?.create) {
      try {
        await this.client.im.message.create(postPayload);
        return;
      } catch {
        await this.client.im.message.create(textPayload);
        return;
      }
    }

    throw new Error("当前飞书 SDK 不支持消息发送接口。");
  }
```

Replace `replyTextToMessage` with:

```ts
  async replyTextToMessage(messageId: string, text: string): Promise<void> {
    const postPayload = {
      path: {
        message_id: messageId,
      },
      data: {
        msg_type: "post",
        content: JSON.stringify(buildFeishuPostContent(text)),
      },
    };
    const textPayload = {
      path: {
        message_id: messageId,
      },
      data: {
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
    };

    if (this.client.im.v1?.message.reply) {
      try {
        await this.client.im.v1.message.reply(postPayload);
        return;
      } catch {
        await this.client.im.v1.message.reply(textPayload);
        return;
      }
    }

    if (this.client.im.message?.reply) {
      try {
        await this.client.im.message.reply(postPayload);
        return;
      } catch {
        await this.client.im.message.reply(textPayload);
        return;
      }
    }

    throw new Error("当前飞书 SDK 不支持消息回复接口。");
  }
```

Remove the old local `escapeAtText()` and `formatTextWithMentions()` functions from `sender.ts`.

- [ ] **Step 4: Run sender tests and verify they pass**

Run:

```bash
npm test -- tests/feishu/sender.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run cron scheduler tests to verify mention compatibility**

Run:

```bash
npm test -- tests/cron/scheduler.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit sender integration**

Run:

```bash
git add src/feishu/sender.ts tests/feishu/sender.test.ts
git commit -m "feat: send Feishu text as rich Markdown posts"
```

---

### Task 3: Full verification and release bump

**Files:**
- Modify: `package.json:1-4`
- Modify: `package-lock.json:1-12`

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run build && npm test && npm run typecheck
```

Expected: build succeeds, all tests pass, typecheck passes.

- [ ] **Step 2: Bump package version**

Change `package.json`:

```json
{
  "name": "chattercatcher",
  "version": "0.1.31"
}
```

Change the top-level `version` and root package `packages[""].version` in `package-lock.json` from `0.1.30` to `0.1.31`.

- [ ] **Step 3: Run full verification after bump**

Run:

```bash
npm run build && npm test && npm run typecheck
```

Expected: build succeeds, all tests pass, typecheck passes.

- [ ] **Step 4: Commit version bump**

Run:

```bash
git add package.json package-lock.json
git commit -m "chore: bump version to 0.1.31"
```

- [ ] **Step 5: Create PR and merge**

Run:

```bash
git push -u origin feishu-markdown-rich-text
gh pr create --title "feat: send Feishu Markdown as rich text" --body "$(cat <<'PR_BODY'
## Summary
- Convert Markdown answers to Feishu post rich text at the sender layer.
- Preserve existing sender APIs and fall back to plain text if rich text sending fails.
- Keep scheduled mention behavior compatible with rich text posts.

## Test plan
- [x] npm run build
- [x] npm test
- [x] npm run typecheck
PR_BODY
)"
gh pr merge --merge --delete-branch
```

Expected: PR is created and merged. If local worktree checkout of `master` fails after merge because another worktree owns `master`, verify the PR state with `gh pr view <number> --json state,mergedAt` and sync the root checkout separately.

- [ ] **Step 6: Sync root master for publish**

Run:

```bash
git -C "/Users/flashingchen/Coding/VibeCoding/ChatterCatcher" fetch origin master
git -C "/Users/flashingchen/Coding/VibeCoding/ChatterCatcher" merge --ff-only origin/master
git -C "/Users/flashingchen/Coding/VibeCoding/ChatterCatcher" status --short --branch
```

Expected: root checkout is on `master`, up to date with `origin/master`, and clean. User can run `npm publish` from the root checkout.
