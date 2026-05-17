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
    const firstText = firstLine[0];
    if (firstText?.tag === "text") {
      content[0] = [...mentionElements, { ...firstText, text: ` ${firstText.text}` }, ...firstLine.slice(1)];
    } else {
      content[0] = [...mentionElements, { tag: "text", text: " " }, ...firstLine];
    }
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
