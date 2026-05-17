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
}

type FeishuPostElement = FeishuPostTextElement;

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

function findMarkdownLinkEnd(text: string, start: number): number {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      if (depth === 0) return index;
      depth -= 1;
    }
  }
  return -1;
}

function stripInlineMarkdown(text: string): string {
  let output = "";
  let index = 0;

  while (index < text.length) {
    const linkStart = text.indexOf("[", index);
    const boldStarStart = text.indexOf("**", index);
    const boldUnderscoreStart = text.indexOf("__", index);
    const candidates = [linkStart, boldStarStart, boldUnderscoreStart].filter((value) => value >= 0);
    const next = candidates.length ? Math.min(...candidates) : -1;

    if (next < 0) {
      output += text.slice(index);
      break;
    }

    output += text.slice(index, next);

    if (next === linkStart) {
      const labelEnd = text.indexOf("](", next);
      if (labelEnd > next) {
        const hrefStart = labelEnd + 2;
        const hrefEnd = findMarkdownLinkEnd(text, hrefStart);
        const href = hrefEnd >= 0 ? text.slice(hrefStart, hrefEnd) : "";
        if (hrefEnd >= 0 && /^https?:\/\/\S+$/.test(href)) {
          output += `${text.slice(next + 1, labelEnd)} ${href}`;
          index = hrefEnd + 1;
          continue;
        }
      }
      output += text[next];
      index = next + 1;
      continue;
    }

    const marker = next === boldStarStart ? "**" : "__";
    const close = text.indexOf(marker, next + marker.length);
    if (close > next + marker.length) {
      output += text.slice(next + marker.length, close);
      index = close + marker.length;
      continue;
    }

    output += marker;
    index = next + marker.length;
  }

  return output;
}

function parseInline(text: string): FeishuPostElement[] {
  return [{ tag: "text", text: stripInlineMarkdown(text) || " " }];
}

function pushParagraph(content: FeishuPostElement[][], lines: string[]): void {
  if (lines.length === 0) return;
  content.push(parseInline(lines.join("\n")));
  lines.length = 0;
}

function parseMarkdownBlocks(markdown: string): FeishuPostElement[][] {
  if (!markdown.trim()) {
    return [[{ tag: "text", text: " " }]];
  }

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
      content.push([{ tag: "text", text: stripInlineMarkdown(heading[1]) || " " }]);
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
    const firstLine = content[0] ?? [];
    const firstText = firstLine[0];
    const prefix = mentions.map((mention) => `@${mention.name}`).join(" ");
    if (firstText?.tag === "text") {
      content[0] = [{ tag: "text", text: `${prefix} ${firstText.text}` }, ...firstLine.slice(1)];
    } else {
      content[0] = [{ tag: "text", text: `${prefix} ` }, ...firstLine];
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
