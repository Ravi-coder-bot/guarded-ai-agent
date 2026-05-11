import React, { useState, useEffect, useCallback } from "react";
import {
  BarChart2, MessageSquare, ShieldX, Wrench, ChevronRight, RefreshCw,
  User, Bot, AlertTriangle, CheckCircle, Clock, DollarSign
} from "lucide-react";
import { logsApi } from "../api/client.ts";

type Conversation = {
  id: string;
  started_at: string;
  ended_at?: string;
  total_input_tokens: number;
  total_output_tokens: number;
  message_count: number;
  first_message?: string;
};

type LogEntry = {
  id: string;
  role: string;
  content: string;
  tool_name?: string;
  tool_input?: string;
  tool_result?: string;
  policy_action?: string;
  timestamp: string;
};

type Stats = {
  totalConversations: number;
  totalToolCalls: number;
  totalBlocked: number;
  blockRate: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: string;
  topBlockedTools: Array<{ tool_name: string; count: number }>;
};

export default function LogViewer({ refreshTrigger }: { refreshTrigger?: number }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [tab, setTab] = useState<"conversations" | "stats">("conversations");

  const loadConversations = useCallback(async () => {
    setLoadingConvs(true);
    try {
      const [convData, statsData] = await Promise.all([
        logsApi.conversations(),
        logsApi.stats(),
      ]);
      setConversations(convData.conversations);
      setStats(statsData);
    } catch (e) {
      console.error("Failed to load conversations", e);
    } finally {
      setLoadingConvs(false);
    }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations, refreshTrigger]);

  async function selectConversation(id: string) {
    setSelectedId(id);
    setLoadingLogs(true);
    try {
      const data = await logsApi.conversation(id);
      setLogs(data.logs);
    } catch (e) {
      console.error("Failed to load logs", e);
    } finally {
      setLoadingLogs(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex border-b border-gray-800 px-4">
        <button
          onClick={() => setTab("conversations")}
          className={`text-sm px-3 py-2.5 border-b-2 transition-colors ${tab === "conversations" ? "border-blue-500 text-blue-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          Conversations
        </button>
        <button
          onClick={() => setTab("stats")}
          className={`text-sm px-3 py-2.5 border-b-2 transition-colors ${tab === "stats" ? "border-blue-500 text-blue-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          Stats & Usage
        </button>
        <button
          onClick={loadConversations}
          disabled={loadingConvs}
          className="ml-auto text-gray-500 hover:text-gray-300 py-2 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loadingConvs ? "animate-spin" : ""}`} />
        </button>
      </div>

      {tab === "stats" && stats && (
        <div className="p-4 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <StatCard icon={<MessageSquare className="w-4 h-4" />} label="Conversations" value={stats.totalConversations} color="text-blue-400" />
            <StatCard icon={<Wrench className="w-4 h-4" />} label="Wrench Calls" value={stats.totalToolCalls} color="text-purple-400" />
            <StatCard icon={<ShieldX className="w-4 h-4" />} label="Blocked" value={`${stats.totalBlocked} (${stats.blockRate}%)`} color="text-red-400" />
            <StatCard icon={<DollarSign className="w-4 h-4" />} label="Est. Cost" value={`$${stats.estimatedCostUsd}`} color="text-green-400" />
          </div>

          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-2">
            <h3 className="text-xs font-medium text-gray-400 flex items-center gap-2">
              <BarChart2 className="w-4 h-4" /> Token Usage
            </h3>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Input tokens</span>
                <span className="text-gray-300">{stats.totalInputTokens.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Output tokens</span>
                <span className="text-gray-300">{stats.totalOutputTokens.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-xs font-medium border-t border-gray-700 pt-1.5">
                <span className="text-gray-400">Total</span>
                <span className="text-gray-200">{(stats.totalInputTokens + stats.totalOutputTokens).toLocaleString()}</span>
              </div>
            </div>
          </div>

          {stats.topBlockedTools.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-2">
              <h3 className="text-xs font-medium text-gray-400">Top Blocked Tools</h3>
              {stats.topBlockedTools.map((t) => (
                <div key={t.tool_name} className="flex items-center gap-2">
                  <code className="text-xs text-red-400 flex-1">{t.tool_name}</code>
                  <span className="text-xs text-gray-500">{t.count}×</span>
                  <div
                    className="h-1.5 bg-red-900 rounded"
                    style={{ width: `${Math.min(t.count * 20, 80)}px` }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "conversations" && (
        <div className="flex flex-1 min-h-0">
          {/* Left: conversation list */}
          <div className="w-72 flex-shrink-0 border-r border-gray-800 overflow-y-auto">
            {conversations.length === 0 && !loadingConvs && (
              <div className="text-center text-gray-500 text-xs py-8">No conversations yet.</div>
            )}
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => selectConversation(c.id)}
                className={`w-full text-left p-3 border-b border-gray-800 hover:bg-gray-800/50 transition-colors ${selectedId === c.id ? "bg-gray-800 border-l-2 border-l-blue-500" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-100 truncate flex-1">
                    {c.first_message?.slice(0, 50) || `Conversation`}
                  </span>
                  <ChevronRight className="w-3 h-3 text-gray-600 flex-shrink-0" />
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-gray-600">
                    {new Date(c.started_at).toLocaleDateString()}
                  </span>
                  <span className="text-xs text-gray-600">·</span>
                  <span className="text-xs text-gray-600">
                    {(c.total_input_tokens + c.total_output_tokens).toLocaleString()} tokens
                  </span>
                </div>
              </button>
            ))}
          </div>

          {/* Right: log detail */}
          <div className="flex-1 overflow-y-auto">
            {!selectedId && (
              <div className="flex items-center justify-center h-full text-gray-500 text-sm flex-col gap-2">
                <MessageSquare className="w-8 h-8 opacity-30" />
                <p>Select a conversation to view its log</p>
              </div>
            )}
            {selectedId && loadingLogs && (
              <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                Loading...
              </div>
            )}
            {selectedId && !loadingLogs && (
              <div className="p-4 space-y-2">
                {logs.map((log) => (
                  <LogRow key={log.id} log={log} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LogRow({ log }: { log: LogEntry }) {
  const [expanded, setExpanded] = useState(false);

  const config: Record<string, { icon: React.ReactNode; bg: string; label: string }> = {
    user: { icon: <User className="w-3.5 h-3.5" />, bg: "bg-blue-900/30 border-blue-800/50", label: "User" },
    assistant: { icon: <Bot className="w-3.5 h-3.5" />, bg: "bg-purple-900/30 border-purple-800/50", label: "Assistant" },
    tool_call: { icon: <Wrench className="w-3.5 h-3.5" />, bg: "bg-gray-800 border-gray-700", label: "Wrench Call" },
    tool_result: { icon: <CheckCircle className="w-3.5 h-3.5" />, bg: "bg-gray-800/50 border-gray-700/50", label: "Wrench Result" },
    policy_block: { icon: <ShieldX className="w-3.5 h-3.5" />, bg: "bg-red-900/30 border-red-800/50", label: "Policy Block" },
    policy_approval_request: { icon: <Clock className="w-3.5 h-3.5" />, bg: "bg-yellow-900/30 border-yellow-800/50", label: "Approval Request" },
    system: { icon: <AlertTriangle className="w-3.5 h-3.5" />, bg: "bg-gray-800 border-gray-700", label: "System" },
  };

  const c = config[log.role] ?? config["system"]!;
  const hasExtra = log.tool_input || log.tool_result || log.policy_action;

  return (
    <div className={`border rounded-lg overflow-hidden ${c.bg}`}>
      <button
        onClick={() => hasExtra && setExpanded(!expanded)}
        className={`w-full text-left flex items-start gap-2 p-2.5 ${hasExtra ? "cursor-pointer" : "cursor-default"}`}
      >
        <span className="text-gray-400 mt-0.5 flex-shrink-0">{c.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-medium text-gray-400">{c.label}</span>
            {log.tool_name && <code className="text-xs text-blue-400">{log.tool_name}</code>}
            {log.policy_action && (
              <span className="text-xs text-red-400 bg-red-900/30 px-1.5 rounded">{log.policy_action}</span>
            )}
            <span className="text-xs text-gray-600 ml-auto flex-shrink-0">
              {new Date(log.timestamp).toLocaleTimeString()}
            </span>
          </div>
          <p className="text-xs text-gray-300 truncate">{log.content}</p>
        </div>
        {hasExtra && (
          <ChevronRight className={`w-3.5 h-3.5 text-gray-600 flex-shrink-0 mt-0.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
        )}
      </button>
      {expanded && hasExtra && (
        <div className="px-3 pb-3 space-y-2 border-t border-gray-700/50 pt-2">
          {log.tool_input && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Input</p>
              <pre className="text-xs text-gray-300 bg-gray-900/50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                {(() => { try { return JSON.stringify(JSON.parse(log.tool_input), null, 2); } catch { return log.tool_input; } })()}
              </pre>
            </div>
          )}
          {log.tool_result && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Result</p>
              <pre className="text-xs text-gray-300 bg-gray-900/50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-40">
                {log.tool_result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon, label, value, color
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
      <div className={`flex items-center gap-2 ${color} mb-2`}>
        {icon}
        <span className="text-xs font-medium text-gray-400">{label}</span>
      </div>
      <p className="text-xl font-semibold text-gray-100">{value}</p>
    </div>
  );
}
