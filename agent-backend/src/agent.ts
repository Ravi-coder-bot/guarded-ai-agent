import {
  GoogleGenerativeAI,
  SchemaType,
  type Content,
  type FunctionDeclaration,
  type FunctionCall,
  type Part,
  type Schema,
} from "@google/generative-ai";
import { v4 as uuidv4 } from "uuid";
import { db } from "./db/database.js";
import { checkPolicy, waitForApproval } from "./policy/engine.js";
import { getAllTools, executeTool } from "./mcp/client.js";
import type { ToolCall } from "./policy/types.js";

const MODEL = process.env["GEMINI_MODEL"] ?? "gemini-2.5-flash";
const MAX_ITERATIONS = 10;

const genAI = new GoogleGenerativeAI(process.env["GEMINI_API_KEY"] ?? "");

export interface AgentMessage { role: "user" | "assistant"; content: string; }
export interface AgentRunResult {
  conversationId: string;
  finalMessage: string;
  events: AgentEvent[];
  usage: { inputTokens: number; outputTokens: number };
}
export type AgentEvent =
  | { type: "thinking"; text: string }
  | { type: "tool_call"; toolName: string; toolInput: Record<string, unknown>; callId: string }
  | { type: "policy_block"; toolName: string; action: string; message: string; ruleId?: string }
  | { type: "approval_pending"; toolName: string; approvalId: string }
  | { type: "tool_result"; callId: string; toolName: string; result: string; isError: boolean }
  | { type: "final_answer"; text: string }
  | { type: "error"; message: string };

// Map JSON Schema type strings → Gemini SchemaType
const TYPE_MAP: Record<string, SchemaType> = {
  string: SchemaType.STRING,
  number: SchemaType.NUMBER,
  integer: SchemaType.INTEGER,
  boolean: SchemaType.BOOLEAN,
  array: SchemaType.ARRAY,
  object: SchemaType.OBJECT,
};

function jsonPropToGemini(prop: Record<string, unknown>): Schema {
  const type = TYPE_MAP[String(prop["type"] ?? "string")] ?? SchemaType.STRING;
  const schema: Schema = {
    type,
    description: String(prop["description"] ?? ""),
  };
  if (prop["enum"]) schema.enum = prop["enum"] as string[];
  if (type === SchemaType.ARRAY) {
    schema.items = { type: SchemaType.STRING };
  }
  return schema;
}

function mcpSchemaToGemini(mcpSchema: Record<string, unknown>): Schema {
  const properties = mcpSchema["properties"] as Record<string, Record<string, unknown>> | undefined;
  const required = mcpSchema["required"] as string[] | undefined;

  if (!properties) {
    return { type: SchemaType.OBJECT, properties: {} };
  }

  const geminiProps: Record<string, Schema> = {};
  for (const [key, prop] of Object.entries(properties)) {
    geminiProps[key] = jsonPropToGemini(prop);
  }

  return {
    type: SchemaType.OBJECT as SchemaType,
    properties: geminiProps,
    required: required ?? [],
  } as Schema;
}

// ─── Main agent loop ──────────────────────────────────────────────────────────
export async function runAgent(
  conversationId: string,
  messages: AgentMessage[],
  onEvent: (event: AgentEvent) => void
): Promise<AgentRunResult> {
  const events: AgentEvent[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  db.conversations.insertIfAbsent({
    id: conversationId,
    started_at: new Date().toISOString(),
    total_input_tokens: 0,
    total_output_tokens: 0,
    model: MODEL,
    message_count: 0,
  });

  function emit(event: AgentEvent): void {
    events.push(event);
    onEvent(event);
    logEvent(conversationId, event);
  }

  // Discover tools dynamically from all connected MCP servers
  const mcpTools = getAllTools();
  const geminiTools = mcpTools.map((t) => ({
    name: t.name,
    description: `[${t.serverName}] ${t.description}`,
    parameters: mcpSchemaToGemini(t.inputSchema),
  })) as FunctionDeclaration[];

  const serverNames = [...new Set(mcpTools.map((t) => t.serverName))].join(", ");
  const systemInstruction = `You are a helpful AI agent with access to ${geminiTools.length} tools from: ${serverNames || "no servers connected yet"}.
Use tools whenever they can help. If a tool is blocked by policy, explain clearly and offer alternatives.
If a tool requires human approval, tell the user you are waiting for an admin to review.`;

  const geminiModel = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction,
    tools: geminiTools.length > 0 ? [{ functionDeclarations: geminiTools }] : undefined,
  });

  // Build chat history from prior messages (all except the current user message)
  const history: Content[] = messages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const chat = geminiModel.startChat({ history });
  const lastMessage = messages[messages.length - 1]!.content;

  let currentParts: Part[] = [{ text: lastMessage }];
  let finalMessage = "";
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    let response;
    try {
      const result = await chat.sendMessage(currentParts);
      response = result.response;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit({ type: "error", message: `LLM API error: ${msg}` });
      return { conversationId, finalMessage: `Error: ${msg}`, events, usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens } };
    }

    // Token tracking
    const usage = response.usageMetadata;
    if (usage) {
      totalInputTokens += usage.promptTokenCount ?? 0;
      totalOutputTokens += usage.candidatesTokenCount ?? 0;
      db.conversations.update(conversationId, {
        total_input_tokens: usage.promptTokenCount ?? 0,
        total_output_tokens: usage.candidatesTokenCount ?? 0,
        message_count: 1,
      });
    }

    const candidate = response.candidates?.[0];
    if (!candidate) {
      emit({ type: "error", message: "No response candidate from Gemini." });
      break;
    }

    // Parse parts into text and function calls
    const functionCalls: FunctionCall[] = [];
    let textOutput = "";

    for (const part of candidate.content.parts) {
      if ("text" in part && part.text) textOutput += part.text;
      if ("functionCall" in part && part.functionCall) functionCalls.push(part.functionCall as FunctionCall);
    }

    if (textOutput) emit({ type: "thinking", text: textOutput });

    // No function calls = final answer
    if (functionCalls.length === 0) {
      finalMessage = textOutput;
      emit({ type: "final_answer", text: textOutput });
      break;
    }

    // Process each function call through the policy engine
    const functionResponseParts: Part[] = [];

    for (const fc of functionCalls) {
      const callId = uuidv4();
      const toolInput = (fc.args ?? {}) as Record<string, unknown>;

      emit({ type: "tool_call", toolName: fc.name, toolInput, callId });

      const toolCall: ToolCall = { id: callId, name: fc.name, input: toolInput };

      // ── Policy check ──────────────────────────────────────────────────────
      const policyResult = await checkPolicy(
        toolCall,
        conversationId,
        parseInt(process.env["APPROVAL_TIMEOUT_MS"] ?? "300000")
      );

      if (["blocked", "injection_detected", "validation_failed", "rate_limited"].includes(policyResult.action)) {
        emit({ type: "policy_block", toolName: fc.name, action: policyResult.action, message: policyResult.message, ruleId: policyResult.rule?.id });
        functionResponseParts.push({
          functionResponse: { name: fc.name, response: { error: `[POLICY] ${policyResult.message}` } },
        });
        continue;
      }

      if (policyResult.action === "approval_required" && policyResult.approvalId) {
        emit({ type: "approval_pending", toolName: fc.name, approvalId: policyResult.approvalId });
        const decision = await waitForApproval(policyResult.approvalId, parseInt(process.env["APPROVAL_TIMEOUT_MS"] ?? "300000"));
        if (decision !== "approved") {
          const msg = decision === "timeout"
            ? `Approval timed out for "${fc.name}".`
            : `Approval denied for "${fc.name}" by admin.`;
          emit({ type: "policy_block", toolName: fc.name, action: decision, message: msg });
          functionResponseParts.push({
            functionResponse: { name: fc.name, response: { error: `[POLICY] ${msg}` } },
          });
          continue;
        }
      }

      // ── Execute via MCP ───────────────────────────────────────────────────
      const { content, isError } = await executeTool(fc.name, toolInput);
      emit({ type: "tool_result", callId, toolName: fc.name, result: content, isError });
      functionResponseParts.push({
        functionResponse: {
          name: fc.name,
          response: isError ? { error: content } : { result: content },
        },
      });
    }

    // Feed all tool results back to the model
    currentParts = functionResponseParts;
  }

  if (iteration >= MAX_ITERATIONS) {
    finalMessage = "Reached maximum iterations. Please try a simpler request.";
    emit({ type: "error", message: finalMessage });
  }

  db.conversations.update(conversationId, { ended_at: new Date().toISOString() });

  return { conversationId, finalMessage, events, usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens } };
}

function logEvent(conversationId: string, event: AgentEvent): void {
  try {
    const id = uuidv4();
    const timestamp = new Date().toISOString();
    const base = { id, conversation_id: conversationId, timestamp };
    switch (event.type) {
      case "thinking":
      case "final_answer":
        db.logs.insert({ ...base, role: "assistant", content: event.text });
        break;
      case "tool_call":
        db.logs.insert({ ...base, role: "tool_call", content: `Tool call: ${event.toolName}`, tool_name: event.toolName, tool_input: JSON.stringify(event.toolInput) });
        break;
      case "tool_result":
        db.logs.insert({ ...base, role: "tool_result", content: `Tool result: ${event.toolName}`, tool_name: event.toolName, tool_result: event.result });
        break;
      case "policy_block":
        db.logs.insert({ ...base, role: "policy_block", content: event.message, tool_name: event.toolName, policy_action: event.action, policy_rule_id: event.ruleId });
        break;
      case "approval_pending":
        db.logs.insert({ ...base, role: "policy_approval_request", content: `Waiting approval: ${event.toolName}`, tool_name: event.toolName });
        break;
    }
  } catch (err) {
    console.error("[Log] Failed:", err);
  }
}
