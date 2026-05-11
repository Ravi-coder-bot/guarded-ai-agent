export type PolicyType =
  | "block"
  | "require_approval"
  | "validate_input"
  | "allow_only"
  | "rate_limit";

export type PolicyAction =
  | "allowed"
  | "blocked"
  | "approval_required"
  | "validation_failed"
  | "rate_limited"
  | "injection_detected";

export interface PolicyRule {
  id: string;
  name: string;
  description?: string;
  type: PolicyType;
  enabled: boolean;
  toolPattern: string; // glob-style: "delete_*", "*", "create_note"
  // For validate_input
  conditionField?: string;   // e.g. "path", "query"
  conditionOperator?: "contains" | "starts_with" | "matches_regex" | "not_contains";
  conditionValue?: string;
  // For rate_limit
  rateLimitCount?: number;   // max calls
  rateLimitWindowMs?: number; // per window
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyCheckResult {
  action: PolicyAction;
  rule?: PolicyRule;
  message: string;
  approvalId?: string; // Set if action === "approval_required"
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ApprovalRequest {
  id: string;
  conversationId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  policyRuleId: string;
  status: "pending" | "approved" | "denied" | "timeout";
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  timeoutAt: string;
}

// Prompt injection patterns to detect
export const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|rules?|policies?)/i,
  /bypass\s+(policy|guardrail|filter|rule|restriction)/i,
  /you\s+are\s+now\s+(in\s+)?(admin|developer|god|unrestricted|jailbreak)\s+mode/i,
  /disregard\s+(your\s+)?(previous|prior|all)\s+(instructions?|constraints?)/i,
  /pretend\s+(you\s+)?(have\s+no\s+restrictions|are\s+unrestricted|are\s+DAN)/i,
  /act\s+as\s+(if\s+you\s+have\s+no\s+restrictions|an?\s+unrestricted\s+AI)/i,
  /do\s+anything\s+now/i,
  /override\s+(safety|policy|guardrail|restriction)/i,
  /\[SYSTEM\].*allow/i,
  /<system>.*allow/i,
  /---\s*new\s+instructions/i,
];
