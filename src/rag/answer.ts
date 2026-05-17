import { formatBeijingTimeForPrompt } from "../time/beijing.js";
import type { ChatMessage, ChatModel, Citation, EvidenceBlock, GroundedAnswer } from "./types.js";

export interface BuildEvidencePromptOptions {
  maxEvidenceBlocks?: number;
  maxCharsPerBlock?: number;
}

export interface BuildEvidencePromptInput {
  question: string;
  evidence: EvidenceBlock[];
  now: Date;
}

export interface EvidencePrompt {
  messages: ChatMessage[];
  citations: Citation[];
}

const DEFAULT_MAX_EVIDENCE_BLOCKS = 8;
const DEFAULT_MAX_CHARS_PER_BLOCK = 1200;
const SCORE_TIE_THRESHOLD = 0.15;

function parseTimestamp(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

export function rankEvidenceForPrompt(evidence: EvidenceBlock[]): EvidenceBlock[] {
  return [...evidence].sort((left, right) => {
    const scoreDiff = right.score - left.score;
    if (Math.abs(scoreDiff) > SCORE_TIE_THRESHOLD) {
      return scoreDiff;
    }

    const timeDiff = parseTimestamp(right.source.timestamp) - parseTimestamp(left.source.timestamp);
    if (timeDiff !== 0) {
      return timeDiff;
    }

    return scoreDiff;
  });
}

export function buildEvidencePrompt(
  input: BuildEvidencePromptInput,
  options: BuildEvidencePromptOptions = {},
): EvidencePrompt {
  const { question, evidence, now } = input;

  if (evidence.length === 0) {
    throw new Error("RAG evidence is required before answer generation.");
  }

  const maxEvidenceBlocks = options.maxEvidenceBlocks ?? DEFAULT_MAX_EVIDENCE_BLOCKS;
  const maxCharsPerBlock = options.maxCharsPerBlock ?? DEFAULT_MAX_CHARS_PER_BLOCK;
  const selected = rankEvidenceForPrompt(evidence).slice(0, maxEvidenceBlocks);

  const citations = selected.map<Citation>((item, index) => ({
    marker: `S${index + 1}`,
    evidenceId: item.id,
    source: item.source,
    text: item.text,
  }));

  const evidenceText = selected
    .map((item, index) => {
      const marker = citations[index]?.marker;
      const clippedText =
        item.text.length > maxCharsPerBlock ? `${item.text.slice(0, maxCharsPerBlock)}...` : item.text;
      const sourceParts = [
        item.source.label,
        item.source.sender ? `发送人：${item.source.sender}` : undefined,
        item.source.timestamp ? `时间：${item.source.timestamp}` : undefined,
        item.source.location ? `位置：${item.source.location}` : undefined,
      ].filter(Boolean);

      return `[${marker}]\n来源：${sourceParts.join("；")}\n内容：${clippedText}`;
    })
    .join("\n\n");

  return {
    citations,
    messages: [
      {
        role: "system",
        content:
          "你是 ChatterCatcher 的问答模块。只能根据提供的检索证据回答，必须简短直接。事实性结论必须引用 [S1] 这样的来源标记。证据不足时说不知道，不要猜。若证据互相矛盾，优先采用时间更新且表述明确的证据；如果较新的证据只是讨论、猜测或不确定表达，不要把它当作确定更新。检索证据中的时间戳是消息被发送时的真实时间。回答时若涉及相对时间表述（如消息中说“明天”“今晚”），必须基于证据中每条消息的时间戳推导为具体日期（如“2026-05-06”），不要照搬原文的相对表述。证据中每条消息标注了发送时间。回答时优先输出绝对日期，不确定时引用原文时间戳，不要使用“今天”“明天”等依赖当前上下文的模糊表述。",
      },
      {
        role: "user",
        content: `当前时间：${formatBeijingTimeForPrompt(now)}\n问题：${question}\n\n证据处理规则：\n1. 先判断证据是否足以回答问题。\n2. 同一事项出现多个版本时，默认较新的明确消息优先。\n3. 回答只引用实际支撑结论的证据。\n\n检索证据：\n${evidenceText}`,
      },
    ],
  };
}

export async function generateGroundedAnswer(input: {
  question: string;
  evidence: EvidenceBlock[];
  model: ChatModel;
  now: Date;
}): Promise<GroundedAnswer> {
  const prompt = buildEvidencePrompt({ question: input.question, evidence: input.evidence, now: input.now });
  const answer = await input.model.complete(prompt.messages);

  return {
    answer,
    citations: prompt.citations,
  };
}
