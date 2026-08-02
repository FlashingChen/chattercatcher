export type AudioTranscriptionTaskStatus = "pending" | "running" | "succeeded" | "skipped" | "failed";

export interface AudioTranscriptionTaskRecord {
  id: string;
  sourceMessageId: string;
  platformMessageId: string;
  audioKey: string;
  storedPath: string;
  mimeType: string;
  status: AudioTranscriptionTaskStatus;
  attempts: number;
  lastError?: string;
  derivedMessageId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueAudioTranscriptionTaskInput {
  sourceMessageId: string;
  platformMessageId: string;
  audioKey: string;
  storedPath: string;
  mimeType: string;
}

export interface TranscribeAudioInput {
  audioPath: string;
  mimeType: string;
}

export interface TranscribeAudioResult {
  text: string;
}

export interface TranscriptionModel {
  transcribe(input: TranscribeAudioInput): Promise<TranscribeAudioResult>;
}
