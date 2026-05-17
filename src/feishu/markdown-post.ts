export interface FeishuTextMention {
  openId: string;
  name: string;
}

export interface SendTextOptions {
  mentions?: FeishuTextMention[];
}

interface FeishuPostMarkdownElement {
  tag: "md";
  text: string;
}

type FeishuPostElement = FeishuPostMarkdownElement;

export interface FeishuPostContent {
  zh_cn: {
    content: FeishuPostElement[][];
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

function buildMarkdownText(markdown: string, options?: SendTextOptions): string {
  return formatTextWithMentions(markdown.trim() || " ", options);
}

export function buildFeishuPostContent(markdown: string, options?: SendTextOptions): FeishuPostContent {
  return {
    zh_cn: {
      content: [[{ tag: "md", text: buildMarkdownText(markdown, options) }]],
    },
  };
}
