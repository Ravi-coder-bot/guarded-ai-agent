import React, { useState, useEffect, useCallback } from "react";
import { Shield, MessageSquare, ScrollText, Clock, Wifi, WifiOff, Bot } from "lucide-react";
import Chat from "./components/Chat.tsx";
import PolicyManager from "./components/PolicyManager.tsx";
import LogViewer from "./components/LogViewer.tsx";
import ApprovalQueue from "./components/ApprovalQueue.tsx";
import { useWebSocket } from "./hooks/useWebSocket.ts";
import { policyApi } from "./api/client.ts";

type Tab = "chat" | "policies" | "logs" | "approvals";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "chat", label: "Agent Chat", icon: <MessageSquare className="w-4 h-4" /> },
  { id: "policies", label: "Policies", icon: <Shield className="w-4 h-4" /> },
  { id: "approvals", label: "Approvals", icon: <Clock className="w-4 h-4" /> },
  { id: "logs", label: "Logs", icon: <ScrollText className="w-4 h-4" /> },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("chat");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  const handleWsMessage = useCallback((msg: { type: string }) => {
    if (
      msg.type === "policies_updated" ||
      msg.type === "conversation_updated" ||
      msg.type === "approval_resolved"
    ) {
      setRefreshTrigger((n) => n + 1);
    }
    if (msg.type === "agent_event") {
      const evt = (msg as { event?: { type?: string } }).event;
      if (evt?.type === "approval_pending") {
        setPendingCount((n) => n + 1);
      }
      if (evt?.type === "approval_resolved") {
        setPendingCount((n) => Math.max(0, n - 1));
      }
    }
  }, []);

  const { connected } = useWebSocket(handleWsMessage);

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
      {/* Top nav */}
      <header className="flex items-center gap-4 px-5 py-3 border-b border-gray-800 bg-gray-900 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
            <Bot className="w-4 h-4" />
          </div>
          <span className="font-semibold text-sm text-gray-100">Guarded AI Agent</span>
        </div>

        <nav className="flex gap-1 ml-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                if (t.id === "approvals") setPendingCount(0);
              }}
              className={`relative flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                tab === t.id
                  ? "bg-gray-700 text-gray-100"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
              }`}
            >
              {t.icon}
              {t.label}
              {t.id === "approvals" && pendingCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-500 text-black text-xs rounded-full flex items-center justify-center font-bold leading-none">
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span
            className={`flex items-center gap-1.5 text-xs ${
              connected ? "text-green-400" : "text-gray-600"
            }`}
          >
            {connected ? (
              <Wifi className="w-3.5 h-3.5" />
            ) : (
              <WifiOff className="w-3.5 h-3.5" />
            )}
            {connected ? "Live" : "Connecting..."}
          </span>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {tab === "chat" && (
          <div className="flex h-full">
            <div className="flex-1 flex flex-col min-w-0">
              <Chat />
            </div>
            <aside className="w-72 border-l border-gray-800 overflow-y-auto flex-shrink-0 hidden lg:block">
              <div className="p-4 border-b border-gray-800">
                <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Active Guards
                </h3>
              </div>
              <PolicySidebar refreshTrigger={refreshTrigger} />
            </aside>
          </div>
        )}
        {tab === "policies" && (
          <div className="h-full overflow-y-auto">
            <PolicyManager onUpdate={() => setRefreshTrigger((n) => n + 1)} />
          </div>
        )}
        {tab === "approvals" && (
          <div className="h-full overflow-y-auto">
            <ApprovalQueue refreshTrigger={refreshTrigger} />
          </div>
        )}
        {tab === "logs" && (
          <div className="h-full">
            <LogViewer refreshTrigger={refreshTrigger} />
          </div>
        )}
      </main>
    </div>
  );
}

const TYPE_COLORS: Record<string, string> = {
  block: "bg-red-400",
  require_approval: "bg-yellow-400",
  validate_input: "bg-blue-400",
  allow_only: "bg-green-400",
  rate_limit: "bg-purple-400",
};

function PolicySidebar({ refreshTrigger }: { refreshTrigger: number }) {
  const [rules, setRules] = useState<
    Array<{ id: string; name: string; type: string; enabled: boolean; toolPattern: string }>
  >([]);

  useEffect(() => {
    policyApi
      .list()
      .then((data) => setRules(data.filter((r) => r.enabled)))
      .catch(() => {});
  }, [refreshTrigger]);

  if (rules.length === 0) {
    return (
      <div className="p-4 text-xs text-gray-600 text-center">
        No active policy rules.
        <br />
        <span className="text-blue-400">Add rules in Policies tab</span>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-1">
      {rules.map((r) => (
        <div
          key={r.id}
          className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-800/50"
        >
          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              TYPE_COLORS[r.type] ?? "bg-gray-400"
            }`}
          />
          <div className="min-w-0">
            <p className="text-xs text-gray-300 truncate">{r.name}</p>
            <code className="text-xs text-gray-600">{r.toolPattern}</code>
          </div>
        </div>
      ))}
    </div>
  );
}
