import { describe, expect, it } from "vitest";
import { buildFeishuPostContent, formatTextWithMentions } from "../../src/feishu/markdown-post.js";

describe("buildFeishuPostContent", () => {
  it("converts paragraphs and headings into Feishu post content", () => {
    expect(buildFeishuPostContent("# 标题\n\n第一段\n第二段")).toEqual({
      post: {
        zh_cn: {
          title: "",
          content: [
            [{ tag: "text", text: "标题" }],
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
            [{ tag: "text", text: "请看 文档 https://example.com 和 重点" }],
          ],
        },
      },
    });
  });

  it("keeps parentheses inside Markdown link URLs", () => {
    expect(buildFeishuPostContent("参考 [条目](https://example.com/a_(b))。" )).toEqual({
      post: {
        zh_cn: {
          title: "",
          content: [
            [{ tag: "text", text: "参考 条目 https://example.com/a_(b)。" }],
          ],
        },
      },
    });
  });

  it("uses a deliberate blank text node for empty Markdown", () => {
    expect(buildFeishuPostContent("")).toEqual({
      post: {
        zh_cn: {
          title: "",
          content: [[{ tag: "text", text: " " }]],
        },
      },
    });
  });

  it("prepends mention elements before a non-text first element", () => {
    expect(buildFeishuPostContent("[文档](https://example.com)", { mentions: [{ openId: "ou_mom", name: "妈妈" }] })).toEqual({
      post: {
        zh_cn: {
          title: "",
          content: [
            [{ tag: "text", text: "@妈妈 文档 https://example.com" }],
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
            [{ tag: "text", text: "@妈妈 记得带水杯" }],
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
