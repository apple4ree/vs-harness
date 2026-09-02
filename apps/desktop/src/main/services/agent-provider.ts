import type {
  AgentMode,
  AgentNativeSessionRef,
  AgentProviderDescriptor,
  AgentProviderId,
} from "../../shared/agent";

export type AgentProviderEvent =
  | { type: "message-delta"; delta: string }
  | { type: "message-completed"; text: string }
  | { type: "tool-started"; command: string }
  | { type: "file-change-started"; paths: string[] }
  | { type: "interaction-denied"; message: string };

export type AgentProviderExecutionInput = {
  cwd: string;
  mode: AgentMode;
  prompt: string;
  continuation?: "resume" | "fork";
  nativeSession?: AgentNativeSessionRef;
};

export type AgentProviderExecutionHandlers = {
  onEvent(event: AgentProviderEvent): void;
  onSession(session: AgentNativeSessionRef): Promise<void> | void;
};

export type AgentProviderExecutionResult = {
  status: "completed" | "interrupted";
};

export class AgentProviderShutdownError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgentProviderShutdownError";
  }
}

export interface AgentProviderAdapter {
  readonly id: AgentProviderId;
  descriptor(): AgentProviderDescriptor;
  isConnected(): boolean;
  execute(
    input: AgentProviderExecutionInput,
    handlers: AgentProviderExecutionHandlers,
  ): Promise<AgentProviderExecutionResult>;
  stop(): Promise<void>;
}
