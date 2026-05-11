/**
 * Custom MCP Server: Notes & Task Manager
 * 6 tools: create_note, list_notes, get_note, update_note, delete_note, search_notes
 * Backed by a JSON file store — zero native dependencies, plug-and-play.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data");
const DB_FILE = path.join(DATA_DIR, "notes.json");

type Note = {
  id: string; title: string; content: string; tags: string[];
  priority: "low"|"medium"|"high"|"urgent"; status: "active"|"completed"|"archived";
  created_at: string; updated_at: string;
};

mkdirSync(DATA_DIR, { recursive: true });

function loadNotes(): Note[] {
  if (!existsSync(DB_FILE)) return [];
  try { return JSON.parse(readFileSync(DB_FILE, "utf8")) as Note[]; } catch { return []; }
}
function saveNotes(notes: Note[]): void {
  writeFileSync(DB_FILE, JSON.stringify(notes, null, 2), "utf8");
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────
const CreateNoteSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  tags: z.array(z.string()).optional().default([]),
  priority: z.enum(["low","medium","high","urgent"]).optional().default("medium"),
});
const ListNotesSchema = z.object({
  status: z.enum(["active","completed","archived","all"]).optional().default("active"),
  priority: z.enum(["low","medium","high","urgent"]).optional(),
  tag: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
});
const GetNoteSchema = z.object({ id: z.string() });
const UpdateNoteSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
  priority: z.enum(["low","medium","high","urgent"]).optional(),
  status: z.enum(["active","completed","archived"]).optional(),
});
const DeleteNoteSchema = z.object({ id: z.string() });
const SearchNotesSchema = z.object({
  query: z.string().min(1),
  in_title: z.boolean().optional().default(true),
  in_content: z.boolean().optional().default(true),
  in_tags: z.boolean().optional().default(true),
  limit: z.number().int().min(1).max(50).optional().default(10),
});

function formatNote(n: Note): string {
  return [
    `ID: ${n.id}`, `Title: ${n.title}`,
    `Priority: ${n.priority} | Status: ${n.status}`,
    `Tags: ${n.tags.length > 0 ? n.tags.join(", ") : "none"}`,
    `Content:\n${n.content}`,
    `Created: ${n.created_at} | Updated: ${n.updated_at}`,
  ].join("\n");
}

const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };

// ─── MCP Server ───────────────────────────────────────────────────────────────
export function createNotesMcpServer(): Server {
  const server = new Server(
    { name: "notes-task-manager", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "create_note", description: "Create a new note or task with title, content, tags, and priority. Returns the created note with its ID.", inputSchema: { type: "object", properties: { title: { type: "string", description: "Note title (max 200 chars)" }, content: { type: "string", description: "Note body" }, tags: { type: "array", items: { type: "string" }, description: "Optional tags" }, priority: { type: "string", enum: ["low","medium","high","urgent"], description: "Priority (default: medium)" } }, required: ["title","content"] } },
    { name: "list_notes", description: "List notes with optional filtering by status, priority, or tag. Sorted by priority.", inputSchema: { type: "object", properties: { status: { type: "string", enum: ["active","completed","archived","all"], description: "Filter by status (default: active)" }, priority: { type: "string", enum: ["low","medium","high","urgent"] }, tag: { type: "string", description: "Filter by tag" }, limit: { type: "number", description: "Max results (default: 20)" }, offset: { type: "number", description: "Pagination offset" } } } },
    { name: "get_note", description: "Retrieve a single note by ID.", inputSchema: { type: "object", properties: { id: { type: "string", description: "Note ID" } }, required: ["id"] } },
    { name: "update_note", description: "Update a note's title, content, tags, priority, or status. Only provided fields change.", inputSchema: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, content: { type: "string" }, tags: { type: "array", items: { type: "string" } }, priority: { type: "string", enum: ["low","medium","high","urgent"] }, status: { type: "string", enum: ["active","completed","archived"] } }, required: ["id"] } },
    { name: "delete_note", description: "Permanently delete a note by ID.", inputSchema: { type: "object", properties: { id: { type: "string", description: "Note ID to delete" } }, required: ["id"] } },
    { name: "search_notes", description: "Full-text search across note titles, content, and tags.", inputSchema: { type: "object", properties: { query: { type: "string", description: "Search query" }, in_title: { type: "boolean", description: "Search in titles (default: true)" }, in_content: { type: "boolean", description: "Search in content (default: true)" }, in_tags: { type: "boolean", description: "Search in tags (default: true)" }, limit: { type: "number", description: "Max results (default: 10)" } }, required: ["query"] } },
  ],
}));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    switch (name) {
      case "create_note": {
        const input = CreateNoteSchema.parse(args);
        const notes = loadNotes();
        const now = new Date().toISOString();
        const note: Note = { id: uuidv4(), title: input.title, content: input.content, tags: input.tags, priority: input.priority, status: "active", created_at: now, updated_at: now };
        notes.push(note);
        saveNotes(notes);
        return { content: [{ type: "text", text: `Note created successfully!\n\n${formatNote(note)}` }] };
      }

      case "list_notes": {
        const input = ListNotesSchema.parse(args);
        let notes = loadNotes();
        if (input.status !== "all") notes = notes.filter((n) => n.status === input.status);
        if (input.priority) notes = notes.filter((n) => n.priority === input.priority);
        if (input.tag) notes = notes.filter((n) => n.tags.includes(input.tag!));
        const total = notes.length;
        notes = notes.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2));
        notes = notes.slice(input.offset, input.offset + input.limit);
        if (notes.length === 0) return { content: [{ type: "text", text: "No notes found matching the criteria." }] };
        const lines = [`Found ${total} note(s) (showing ${input.offset + 1}–${Math.min(input.offset + input.limit, total)}):`, "",
          ...notes.map((n, i) => `${input.offset + i + 1}. [${n.priority.toUpperCase()}] ${n.title} (${n.status}) — ID: ${n.id}\n   Tags: ${n.tags.join(", ") || "none"}`)];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "get_note": {
        const input = GetNoteSchema.parse(args);
        const note = loadNotes().find((n) => n.id === input.id);
        if (!note) return { content: [{ type: "text", text: `Note "${input.id}" not found.` }], isError: true };
        return { content: [{ type: "text", text: formatNote(note) }] };
      }

      case "update_note": {
        const input = UpdateNoteSchema.parse(args);
        const notes = loadNotes();
        const idx = notes.findIndex((n) => n.id === input.id);
        if (idx === -1) return { content: [{ type: "text", text: `Note "${input.id}" not found.` }], isError: true };
        const now = new Date().toISOString();
        if (input.title !== undefined) notes[idx]!.title = input.title;
        if (input.content !== undefined) notes[idx]!.content = input.content;
        if (input.tags !== undefined) notes[idx]!.tags = input.tags;
        if (input.priority !== undefined) notes[idx]!.priority = input.priority;
        if (input.status !== undefined) notes[idx]!.status = input.status;
        notes[idx]!.updated_at = now;
        saveNotes(notes);
        return { content: [{ type: "text", text: `Note updated!\n\n${formatNote(notes[idx]!)}` }] };
      }

      case "delete_note": {
        const input = DeleteNoteSchema.parse(args);
        const notes = loadNotes();
        const idx = notes.findIndex((n) => n.id === input.id);
        if (idx === -1) return { content: [{ type: "text", text: `Note "${input.id}" not found.` }], isError: true };
        const [deleted] = notes.splice(idx, 1);
        saveNotes(notes);
        return { content: [{ type: "text", text: `Note "${deleted!.title}" deleted permanently.` }] };
      }

      case "search_notes": {
        const input = SearchNotesSchema.parse(args);
        const q = input.query.toLowerCase();
        let notes = loadNotes().filter((n) => n.status !== "archived");
        notes = notes.filter((n) => {
          if (input.in_title && n.title.toLowerCase().includes(q)) return true;
          if (input.in_content && n.content.toLowerCase().includes(q)) return true;
          if (input.in_tags && n.tags.some((t) => t.toLowerCase().includes(q))) return true;
          return false;
        });
        notes = notes.slice(0, input.limit);
        if (notes.length === 0) return { content: [{ type: "text", text: `No notes found for "${input.query}".` }] };
        const lines = [`Search results for "${input.query}" (${notes.length} found):`, "",
          ...notes.map((n, i) => `${i + 1}. ${n.title} — ID: ${n.id}\n   ${n.content.substring(0, 100).replace(/\n/g, " ")}${n.content.length > 100 ? "..." : ""}`)];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (err) {
    if (err instanceof McpError) throw err;
    return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
  }
});

  return server;
}

export async function startNotesMcpServerStdio(): Promise<void> {
  const server = createNotesMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[Notes MCP] Server ready on stdio");
}

const isMainModule =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  await startNotesMcpServerStdio();
}
