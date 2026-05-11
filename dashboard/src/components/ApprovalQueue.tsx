import React, { useState, useEffect, useCallback } from "react";
import { CheckCircle, XCircle, Clock, Wrench, RefreshCw, AlertTriangle } from "lucide-react";
import { policyApi } from "../api/client.ts";

type Approval = {
  id: string;
  conversationId: string;
  toolName: string;
  toolInput: string;
  policyRuleId: string;
  status: string;
  createdAt: string;
  timeoutAt: string;
};

export default function ApprovalQueue({ refreshTrigger }: { refreshTrigger?: number }) {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await policyApi.pendingApprovals();
      setApprovals(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load approvals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  // Poll every 3s for new approvals
  useEffect(() => {
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load]);

  async function resolve(id: string, decision: "approved" | "denied") {
    setResolving(id);
    try {
      await policyApi.resolveApproval(id, decision);
      setApprovals((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to resolve");
    } finally {
      setResolving(null);
    }
  }

  function timeUntilTimeout(timeoutAt: string): string {
    const ms = new Date(timeoutAt).getTime() - Date.now();
    if (ms <= 0) return "Expired";
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-yellow-400" />
          <h2 className="font-semibold text-gray-100">Approval Queue</h2>
          {approvals.length > 0 && (
            <span className="text-xs bg-yellow-900/50 text-yellow-300 border border-yellow-800 rounded-full px-2 py-0.5 animate-pulse">
              {approvals.length} pending
            </span>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-gray-500 hover:text-gray-300 transition-colors p-1"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">✕</button>
        </div>
      )}

      {approvals.length === 0 && !loading && (
        <div className="text-center text-gray-500 text-sm py-8 flex flex-col items-center gap-2">
          <CheckCircle className="w-8 h-8 opacity-30" />
          <p>No pending approvals</p>
          <p className="text-xs text-gray-600">When the agent needs approval to run a tool, requests appear here.</p>
        </div>
      )}

      <div className="space-y-3">
        {approvals.map((a) => {
          let inputObj: Record<string, unknown> = {};
          try { inputObj = JSON.parse(a.toolInput); } catch { /* ignore */ }

          return (
            <div key={a.id} className="border border-yellow-800/50 bg-yellow-900/10 rounded-xl p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-yellow-900/50 border border-yellow-800 flex items-center justify-center flex-shrink-0">
                  <Wrench className="w-4 h-4 text-yellow-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-100">{a.toolName}</span>
                    <span className="text-xs text-gray-500">
                      Conv: {a.conversationId.slice(0, 8)}…
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Requested {new Date(a.createdAt).toLocaleTimeString()} · Expires in{" "}
                    <TimeCountdown timeoutAt={a.timeoutAt} />
                  </p>
                </div>
              </div>

              {/* Wrench input */}
              {Object.keys(inputObj).length > 0 && (
                <div className="bg-gray-900/50 rounded-lg p-3 space-y-1">
                  <p className="text-xs text-gray-500 font-medium mb-1">Wrench Arguments</p>
                  {Object.entries(inputObj).map(([k, v]) => (
                    <div key={k} className="flex gap-2 text-xs">
                      <span className="text-gray-500 flex-shrink-0">{k}:</span>
                      <span className="text-gray-300 break-all">
                        {typeof v === "string" ? v : JSON.stringify(v)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => resolve(a.id, "approved")}
                  disabled={resolving === a.id}
                  className="flex-1 flex items-center justify-center gap-1.5 text-sm bg-green-700 hover:bg-green-600 disabled:opacity-50 rounded-lg py-2 font-medium transition-colors"
                >
                  <CheckCircle className="w-4 h-4" />
                  Approve
                </button>
                <button
                  onClick={() => resolve(a.id, "denied")}
                  disabled={resolving === a.id}
                  className="flex-1 flex items-center justify-center gap-1.5 text-sm bg-red-800 hover:bg-red-700 disabled:opacity-50 rounded-lg py-2 font-medium transition-colors"
                >
                  <XCircle className="w-4 h-4" />
                  Deny
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimeCountdown({ timeoutAt }: { timeoutAt: string }) {
  const [label, setLabel] = useState("");

  useEffect(() => {
    function update() {
      const ms = new Date(timeoutAt).getTime() - Date.now();
      if (ms <= 0) { setLabel("expired"); return; }
      const mins = Math.floor(ms / 60000);
      const secs = Math.floor((ms % 60000) / 1000);
      setLabel(mins > 0 ? `${mins}m ${secs}s` : `${secs}s`);
    }
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [timeoutAt]);

  return <span className="text-yellow-400">{label}</span>;
}
