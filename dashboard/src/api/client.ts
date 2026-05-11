const BASE = import.meta.env["VITE_API_URL"]
  ? `${import.meta.env["VITE_API_URL"]}/api`
  : "/api";

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Agent ────────────────────────────────────────────────────────────────────
export const chatApi = {
  send: (message: string, conversationId?: string, history?: Array<{role: "user"|"assistant"; content: string}>) =>
    request<{
      conversationId: string;
      response: string;
      events: Record<string, unknown>[];
      usage: { inputTokens: number; outputTokens: number };
    }>("/chat", {
      method: "POST",
      body: JSON.stringify({ message, conversationId, history }),
    }),

  servers: () =>
    request<Array<{ id: string; name: string; status: string; toolCount: number; lastError?: string }>>("/chat/servers"),
};

// ─── Policies ─────────────────────────────────────────────────────────────────
export type PolicyRule = {
  id: string;
  name: string;
  description?: string;
  type: "block" | "require_approval" | "validate_input" | "allow_only" | "rate_limit";
  enabled: boolean;
  toolPattern: string;
  conditionField?: string;
  conditionOperator?: string;
  conditionValue?: string;
  rateLimitCount?: number;
  rateLimitWindowMs?: number;
  priority: number;
  createdAt: string;
  updatedAt: string;
};

export const policyApi = {
  list: () => request<PolicyRule[]>("/policies"),
  get: (id: string) => request<PolicyRule>(`/policies/${id}`),
  create: (data: Omit<PolicyRule, "id" | "createdAt" | "updatedAt">) =>
    request<PolicyRule>("/policies", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<PolicyRule>) =>
    request<PolicyRule>(`/policies/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) => request<{ success: boolean }>(`/policies/${id}`, { method: "DELETE" }),
  toggle: (id: string) => request<PolicyRule>(`/policies/${id}/toggle`, { method: "POST" }),
  pendingApprovals: () =>
    request<Array<{
      id: string;
      conversationId: string;
      toolName: string;
      toolInput: string;
      policyRuleId: string;
      status: string;
      createdAt: string;
      timeoutAt: string;
    }>>("/policies/approvals/pending"),
  resolveApproval: (id: string, decision: "approved" | "denied") =>
    request(`/policies/approvals/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ decision, resolvedBy: "admin" }),
    }),
};

// ─── Logs ─────────────────────────────────────────────────────────────────────
export const logsApi = {
  conversations: (limit = 20, offset = 0) =>
    request<{
      conversations: Array<{
        id: string;
        started_at: string;
        ended_at?: string;
        total_input_tokens: number;
        total_output_tokens: number;
        message_count: number;
        first_message?: string;
      }>;
      total: number;
    }>(`/logs/conversations?limit=${limit}&offset=${offset}`),

  conversation: (id: string) =>
    request<{
      conversation: Record<string, unknown>;
      logs: Array<{
        id: string;
        role: string;
        content: string;
        tool_name?: string;
        tool_input?: string;
        tool_result?: string;
        policy_action?: string;
        timestamp: string;
      }>;
    }>(`/logs/conversations/${id}`),

  stats: () =>
    request<{
      totalConversations: number;
      totalToolCalls: number;
      totalBlocked: number;
      blockRate: string;
      totalInputTokens: number;
      totalOutputTokens: number;
      estimatedCostUsd: string;
      topBlockedTools: Array<{ tool_name: string; count: number }>;
    }>("/logs/stats"),
};
