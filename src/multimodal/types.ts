export type ImageMultimodalTaskStatus = "pending" | "running" | "succeeded" | "skipped" | "failed";

export interface ImageMultimodalTaskRecord {
  id: string;
  sourceMessageId: string;
  platformMessageId: string;
  imageKey: string;
  storedPath: string;
  mimeType: string;
  status: ImageMultimodalTaskStatus;
  attempts: number;
  lastError?: string;
  derivedMessageId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueImageMultimodalTaskInput {
  sourceMessageId: string;
  platformMessageId: string;
  imageKey: string;
  storedPath: string;
  mimeType: string;
}

export interface DescribeImageInput {
  imagePath: string;
  mimeType: string;
  context?: string;
}

export interface DescribeImageResult {
  summary: string;
  isMeaningful: boolean;
  reason?: string;
  extractedText?: string;
}

export interface MultimodalModel {
  describeImage(input: DescribeImageInput): Promise<DescribeImageResult>;
}
