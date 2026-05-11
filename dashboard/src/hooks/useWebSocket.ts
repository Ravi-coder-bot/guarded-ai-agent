import { useEffect, useRef, useState, useCallback } from "react";

export type WsMessage =
  | { type: "connected"; timestamp: string }
  | { type: "policies_updated" }
  | { type: "conversation_updated"; conversationId: string }
  | { type: "approval_resolved"; approvalId: string; decision: string }
  | { type: "agent_event"; conversationId: string; event: Record<string, unknown> };

type MessageHandler = (msg: WsMessage) => void;

export function useWebSocket(onMessage: MessageHandler) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const apiUrl = import.meta.env["VITE_API_URL"] ?? "";
      const wsUrl = apiUrl
        ? apiUrl.replace(/^https/, "wss").replace(/^http/, "ws") + "/ws"
        : `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        console.log("[WS] Connected");
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data) as WsMessage;
          handlerRef.current(msg);
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        setConnected(false);
        console.log("[WS] Disconnected, reconnecting in 2s...");
        setTimeout(connect, 2000);
      };

      ws.onerror = (e) => {
        console.error("[WS] Error", e);
        ws.close();
      };
    }

    connect();
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((payload: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  return { connected, send };
}
