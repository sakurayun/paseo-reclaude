import { z } from "zod";

// Shared MCP wire shape for a terminal, used by the terminal tools in
// paseo-tools.ts and the SSH tools in ssh-tools.ts. All enrichment fields are
// optional so older stubs/tests that only produce {id,name,cwd} keep parsing.
export const TerminalSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  cwd: z.string(),
  workspaceId: z.string().optional(),
  title: z.string().optional(),
  // Absent status means "running" (matches TerminalListItem semantics).
  status: z.enum(["running", "exited"]).optional(),
  exitCode: z.number().nullable().optional(),
  activity: z.enum(["idle", "working", "attention"]).nullable().optional(),
  kind: z.enum(["local", "ssh"]).optional(),
  sshHostId: z.string().optional(),
  sshHostLabel: z.string().optional(),
});

export type TerminalSummary = z.infer<typeof TerminalSummarySchema>;
