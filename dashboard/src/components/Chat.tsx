import React, { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Wrench, ShieldX, Clock, Loader2, Server } from "lucide-react";
import { chatApi } from "../api/client.ts";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  events?: Record<string, unknown>[];
  usage?: { inputTokens: number; outputTokens: number };
};

type McpServer = { id: string; name: string; status: string; toolCount: number };

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [convId, setConvId] = useState<string | undefined>(undefined);
  const [servers, setServers] = useState<McpServer[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatApi.servers().then(setServers).catch(() => {});
    const interval = setInterval(() => chatApi.servers().then(setServers).catch(() => {}), 10_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage() {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput("");

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    try {
      const result = await chatApi.send(text, convId, history);
      setConvId(result.conversationId);
      setMessages((prev) => [
        ...prev,
        {
          id: result.conversationId + Date.now(),
          role: "assistant",
          content: result.response,
          events: result.events,
          usage: result.usage,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: "err" + Date.now(),
          role: "assistant",
          content: `⚠️ Error: ${err instanceof Error ? err.message : "Unknown error"}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function newConversation() {
    setMessages([]);
    setConvId(undefined);
  }

  return (
    <div className="flex flex-col h-full">
      {/* MCP server status bar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-900 border-b border-gray-800 text-xs overflow-x-auto">
        <Server className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
        {servers.length === 0 ? (
          <span className="text-gray-500">Connecting to MCP servers...</span>
        ) : (
          servers.map((s) => (
            <div key={s.id} className="flex items-center gap-1.5 flex-shrink-0">
              <span className={`w-1.5 h-1.5 rounded-full ${s.status === "ready" ? "bg-green-400" : s.status === "connecting" ? "bg-yellow-400" : "bg-red-400"}`} />
              <span className="text-gray-400">{s.name}</span>
              <span className="text-gray-600">({s.toolCount} tools)</span>
            </div>
          ))
        )}
        <div className="ml-auto">
          <button onClick={newConversation} className="text-gray-500 hover:text-gray-300 transition-colors">
            New conversation
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
            <Bot className="w-12 h-12 opacity-30" />
            <p className="text-sm">Start a conversation. The agent has access to your MCP tools.</p>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              {["Create a note about my project ideas", "List all my active notes", "Search notes about meetings", "What tools do you have?"].map((s) => (
                <button
                  key={s}
                  onClick={() => { setInput(s); }}
                  className="text-xs px-3 py-1.5 rounded-full bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${msg.role === "user" ? "bg-blue-600" : "bg-purple-700"}`}>
              {msg.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>
            <div className={`max-w-[75%] space-y-2 ${msg.role === "user" ? "items-end" : "items-start"}`}>
              {/* Event pills */}
              {msg.events && msg.events.filter(e => ["tool_call","policy_block","approval_pending","tool_result"].includes(e.type as string)).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {msg.events.filter(e => ["tool_call","policy_block","approval_pending"].includes(e.type as string)).map((e, i) => (
                    <EventPill key={i} event={e} />
                  ))}
                </div>
              )}
              <div className={`rounded-xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${msg.role === "user" ? "bg-blue-600 text-white rounded-tr-sm" : "bg-gray-800 text-gray-100 rounded-tl-sm"}`}>
                {msg.content || "..."}
              </div>
              {msg.usage && (
                <div className="text-xs text-gray-600">
                  {msg.usage.inputTokens + msg.usage.outputTokens} tokens
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-purple-700 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Bot className="w-4 h-4" />
            </div>
            <div className="bg-gray-800 rounded-xl rounded-tl-sm px-4 py-2.5">
              <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-800">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Message the agent..."
            disabled={loading}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50 transition-colors"
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg px-4 py-2.5 transition-colors flex items-center gap-2 text-sm font-medium"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function EventPill({ event }: { event: Record<string, unknown> }) {
  const type = event["type"] as string;

  if (type === "tool_call") {
    return (
      <span className="flex items-center gap-1 text-xs bg-blue-900/50 text-blue-300 border border-blue-800 rounded-full px-2 py-0.5">
        <Wrench className="w-3 h-3" />
        {event["toolName"] as string}
      </span>
    );
  }
  if (type === "policy_block") {
    return (
      <span className="flex items-center gap-1 text-xs bg-red-900/50 text-red-300 border border-red-800 rounded-full px-2 py-0.5" title={event["message"] as string}>
        <ShieldX className="w-3 h-3" />
        Blocked: {event["toolName"] as string}
      </span>
    );
  }
  if (type === "approval_pending") {
    return (
      <span className="flex items-center gap-1 text-xs bg-yellow-900/50 text-yellow-300 border border-yellow-800 rounded-full px-2 py-0.5">
        <Clock className="w-3 h-3" />
        Awaiting approval: {event["toolName"] as string}
      </span>
    );
  }
  return null;
}
