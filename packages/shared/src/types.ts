// ========================================
// Wizard Level
// ========================================
export enum WizardLevel {
  APPRENTICE = 'APPRENTICE',
  SKILLED = 'SKILLED',
  ARCHMAGE = 'ARCHMAGE',
}

// ========================================
// Design Style
// ========================================
export enum DesignStyle {
  MINIMAL = 'MINIMAL',
  MODERN = 'MODERN',
  PLAYFUL = 'PLAYFUL',
  COLORFUL = 'COLORFUL',
  CUSTOM = 'CUSTOM',
}

// ========================================
// Auth Type
// ========================================
export enum AuthType {
  NONE = 'NONE',
  EMAIL = 'EMAIL',
  SOCIAL = 'SOCIAL',
}

// ========================================
// Agent Status
// ========================================
export enum AgentStatus {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  WAITING = 'WAITING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  RETRYING = 'RETRYING',
  CANCELLED = 'CANCELLED',
}

// ========================================
// Agent Completion Mode
// ========================================
export enum CompletionMode {
  AUTO_CLOSE = 'auto_close',
  REQUIRES_REVIEW = 'requires_review',
}

// ========================================
// File Types
// ========================================
export interface UploadedFile {
  id: string;
  s3Key: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  description: string;
  parsedText?: string;
  parsedLayout?: any;
  parsedTables?: any;
  confidence?: number;
}

// ========================================
// Survey Types
// ========================================
export interface SurveyAnswer {
  wizardLevel: WizardLevel;
  designTemplate?: string;
  colorTheme: string;
  designStyle: DesignStyle;
  referenceSiteUrl?: string;
  authType: AuthType;
  requiredPages: string[];
  databaseTables: string[];
  externalApis: string[];
  specialRequests?: string;
}

// ========================================
// Agent Types
// ========================================
export interface AgentConfig {
  agentId: string;
  name: string;
  role: string;
  trigger: AgentTrigger;
  completionMode: CompletionMode;
  maxRetries: number;
  timeout: number;
  dependencies: string[];
  contextSharing: ContextSharing;
}

export interface AgentTrigger {
  type: 'event' | 'dependency_satisfied';
  event?: string;
  dependencies?: string[];
  condition?: string;
}

export interface ContextSharing {
  sharesTo: string[];
  data: string[];
}

export interface AgentContext {
  agentId: string;
  timestamp: string;
  data: Record<string, any>;
  metadata: {
    version: string;
    ttl?: number;
  };
}

export interface AgentExecutionResult {
  status: AgentStatus;
  output?: any;
  error?: {
    message: string;
    stackTrace?: string;
    retryable: boolean;
  };
  attachments?: Attachment[];
  comments?: Comment[];
}

export interface Attachment {
  type: 'screenshot' | 'log' | 'code_diff' | 'other';
  url: string;
  description?: string;
}

export interface Comment {
  type: 'info' | 'warning' | 'error' | 'success';
  message: string;
  timestamp: string;
}
