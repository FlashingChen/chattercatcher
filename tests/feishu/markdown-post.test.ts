import { describe, expect, it } from "vitest";
import { buildFeishuPostContent, formatTextWithMentions } from "../../src/feishu/markdown-post.js";

describe("buildFeishuPostContent", () => {
  it("wraps Markdown in a Feishu md post row without a post wrapper or empty title", () => {
    expect(buildFeishuPostContent("# 标题\n\n第一段 **重点**")).toEqual({
      zh_cn: {
        content: [[{ tag: "md", text: "# 标题\n\n第一段 **重点**" }]],
      },
    });
  });

  it("keeps fenced code blocks inside the md text", () => {
    expect(buildFeishuPostContent("说明\n\n```ts\nconst a = 1;\n```\n\n后文")).toEqual({
      zh_cn: {
        content: [[{ tag: "md", text: "说明\n\n```ts\nconst a = 1;\n```\n\n后文" }]],
      },
    });
  });

  it("uses a deliberate blank md node for empty Markdown", () => {
    expect(buildFeishuPostContent("")).toEqual({
      zh_cn: {
        content: [[{ tag: "md", text: " " }]],
      },
    });
  });

  it("prepends mention markup into the md text", () => {
    expect(buildFeishuPostContent("记得带水杯", { mentions: [{ openId: "ou_mom", name: "妈妈" }] })).toEqual({
      zh_cn: {
        content: [[{ tag: "md", text: '<at user_id="ou_mom">妈妈</at> 记得带水杯' }]],
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
