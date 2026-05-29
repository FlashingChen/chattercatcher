export type PersonIdentitySource = "message" | "feishu_member" | "manual" | "inferred";
export type ProfileEntryType = "fact" | "inferred";
export type ProfileEntryStatus = "active" | "superseded" | "deleted";
export type ProfileEntrySource = "dream" | "explicit_user_request" | "manual";

export interface PersonRecord {
  id: string;
  primaryName: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvePersonInput {
  platform: string;
  platformChatId: string;
  senderId: string;
  senderName: string;
  source: PersonIdentitySource;
  observedAt?: string;
}

export interface ProfileEvidenceInput {
  messageId: string;
  quote: string;
  reason: string;
}

export interface UpsertProfileEntryInput {
  personId: string;
  category: string;
  content: string;
  entryType: ProfileEntryType;
  confidence: number;
  source: ProfileEntrySource;
  evidence: ProfileEvidenceInput[];
  observedAt?: string;
}

export interface ProfileEvidenceRecord extends ProfileEvidenceInput {
  entryId: string;
}

export interface ProfileEntryRecord {
  id: string;
  personId: string;
  category: string;
  content: string;
  entryType: ProfileEntryType;
  confidence: number;
  status: ProfileEntryStatus;
  source: ProfileEntrySource;
  createdAt: string;
  updatedAt: string;
  lastObservedAt: string;
  evidence?: ProfileEvidenceRecord[];
}

export interface PersonProfile {
  person: PersonRecord;
  entries: ProfileEntryRecord[];
}

export interface DreamStateRecord {
  platform: string;
  platformChatId: string;
  lastMessageId?: string;
  lastMessageSentAt?: string;
  updatedAt?: string;
}
