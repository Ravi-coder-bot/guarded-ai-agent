/**
 * Lightweight JSON-backed store that mimics a synchronous DB interface.
 * Replaces better-sqlite3 for zero-native-dep portability.
 * Data is persisted to JSON files on every write.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../../data");

// ─── Table types ─────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
type Tables = {
  policy_rules: Row[];
  conversations: Row[];
  conversation_logs: Row[];
  approval_requests: Row[];
  rate_limit_tracking: Row[];
};

// ─── In-memory store ─────────────────────────────────────────────────────────
let store: Tables = {
  policy_rules: [],
  conversations: [],
  conversation_logs: [],
  approval_requests: [],
  rate_limit_tracking: [],
};

const DB_FILE = path.join(DATA_DIR, "agent.json");

function persist(): void {
  writeFileSync(DB_FILE, JSON.stringify(store, null, 2), "utf8");
}

export function initDatabase(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(DB_FILE)) {
    try {
      const raw = readFileSync(DB_FILE, "utf8");
      const loaded = JSON.parse(raw) as Partial<Tables>;
      store = {
        policy_rules: loaded.policy_rules ?? [],
        conversations: loaded.conversations ?? [],
        conversation_logs: loaded.conversation_logs ?? [],
        approval_requests: loaded.approval_requests ?? [],
        rate_limit_tracking: loaded.rate_limit_tracking ?? [],
      };
      console.log("[DB] Loaded", Object.entries(store).map(([k, v]) => `${k}:${v.length}`).join(", "));
    } catch {
      console.warn("[DB] Could not parse DB file, starting fresh.");
    }
  } else {
    persist();
    console.log("[DB] Created new JSON store at", DB_FILE);
  }
}

// ─── Public query API (synchronous, mimics better-sqlite3) ───────────────────
export const db = {
  // ── policy_rules ──────────────────────────────────────────────────────────
  policyRules: {
    all(): Row[] {
      return [...store.policy_rules].sort(
        (a, b) => (Number(b["priority"]) - Number(a["priority"]))
      );
    },
    get(id: string): Row | undefined {
      return store.policy_rules.find((r) => r["id"] === id);
    },
    insert(row: Row): void {
      store.policy_rules.push(row);
      persist();
    },
    update(id: string, patch: Partial<Row>): void {
      const idx = store.policy_rules.findIndex((r) => r["id"] === id);
      if (idx !== -1) {
        store.policy_rules[idx] = { ...store.policy_rules[idx], ...patch };
        persist();
      }
    },
    delete(id: string): boolean {
      const before = store.policy_rules.length;
      store.policy_rules = store.policy_rules.filter((r) => r["id"] !== id);
      if (store.policy_rules.length !== before) { persist(); return true; }
      return false;
    },
    count(): number { return store.policy_rules.length; },
  },

  // ── conversations ─────────────────────────────────────────────────────────
  conversations: {
    get(id: string): Row | undefined {
      return store.conversations.find((c) => c["id"] === id);
    },
    insertIfAbsent(row: Row): void {
      if (!store.conversations.find((c) => c["id"] === row["id"])) {
        store.conversations.push(row);
        persist();
      }
    },
    update(id: string, patch: Partial<Row>): void {
      const idx = store.conversations.findIndex((c) => c["id"] === id);
      if (idx !== -1) {
        const c = store.conversations[idx]!;
        for (const [k, v] of Object.entries(patch)) {
          if (typeof v === "number" && typeof c[k] === "number") {
            c[k] = (c[k] as number) + v; // additive for tokens
          } else {
            c[k] = v;
          }
        }
        persist();
      }
    },
    all(limit = 20, offset = 0): Row[] {
      const sorted = [...store.conversations].sort(
        (a, b) => String(b["started_at"]).localeCompare(String(a["started_at"]))
      );
      return sorted.slice(offset, offset + limit).map((c) => ({
        ...c,
        first_message: store.conversation_logs.find(
          (l) => l["conversation_id"] === c["id"] && l["role"] === "user"
        )?.["content"],
      }));
    },
    count(): number { return store.conversations.length; },
  },

  // ── conversation_logs ─────────────────────────────────────────────────────
  logs: {
    insert(row: Row): void {
      store.conversation_logs.push(row);
      persist();
    },
    forConversation(conversationId: string): Row[] {
      return store.conversation_logs
        .filter((l) => l["conversation_id"] === conversationId)
        .sort((a, b) => String(a["timestamp"]).localeCompare(String(b["timestamp"])));
    },
    countByRole(role: string): number {
      return store.conversation_logs.filter((l) => l["role"] === role).length;
    },
    topBlockedTools(limit = 5): Array<{ tool_name: string; count: number }> {
      const counts: Record<string, number> = {};
      for (const l of store.conversation_logs) {
        if (l["role"] === "policy_block" && l["tool_name"]) {
          const t = String(l["tool_name"]);
          counts[t] = (counts[t] ?? 0) + 1;
        }
      }
      return Object.entries(counts)
        .map(([tool_name, count]) => ({ tool_name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
    },
  },

  // ── approval_requests ─────────────────────────────────────────────────────
  approvals: {
    insert(row: Row): void {
      store.approval_requests.push(row);
      persist();
    },
    get(id: string): Row | undefined {
      return store.approval_requests.find((a) => a["id"] === id);
    },
    update(id: string, patch: Partial<Row>): void {
      const idx = store.approval_requests.findIndex((a) => a["id"] === id);
      if (idx !== -1) {
        store.approval_requests[idx] = { ...store.approval_requests[idx], ...patch };
        persist();
      }
    },
    pending(): Row[] {
      const now = new Date().toISOString();
      // expire timed-out ones
      for (const a of store.approval_requests) {
        if (a["status"] === "pending" && String(a["timeout_at"]) < now) {
          a["status"] = "timeout";
        }
      }
      return store.approval_requests
        .filter((a) => a["status"] === "pending")
        .sort((a, b) => String(b["created_at"]).localeCompare(String(a["created_at"])));
    },
  },

  // ── rate_limit_tracking ────────────────────────────────────────────────────
  rateLimit: {
    getCount(toolName: string, windowStart: string): number {
      return Number(
        store.rate_limit_tracking.find(
          (r) => r["tool_name"] === toolName && r["window_start"] === windowStart
        )?.["call_count"] ?? 0
      );
    },
    increment(toolName: string, windowStart: string): void {
      const idx = store.rate_limit_tracking.findIndex(
        (r) => r["tool_name"] === toolName && r["window_start"] === windowStart
      );
      if (idx !== -1) {
        store.rate_limit_tracking[idx]!["call_count"] =
          Number(store.rate_limit_tracking[idx]!["call_count"]) + 1;
      } else {
        store.rate_limit_tracking.push({ tool_name: toolName, window_start: windowStart, call_count: 1 });
      }
      persist();
    },
  },

  // ── aggregate stats ────────────────────────────────────────────────────────
  stats() {
    const allConvs = store.conversations;
    const totalInputTokens = allConvs.reduce((s, c) => s + Number(c["total_input_tokens"] ?? 0), 0);
    const totalOutputTokens = allConvs.reduce((s, c) => s + Number(c["total_output_tokens"] ?? 0), 0);
    return { totalInputTokens, totalOutputTokens };
  },
};
