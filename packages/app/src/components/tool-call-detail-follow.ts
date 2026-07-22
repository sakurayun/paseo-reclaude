export type ToolCallDetailStatus = "executing" | "running" | "completed" | "failed" | "canceled";

export function shouldFollowToolCallDetailEnd(
  toolName: string,
  status: ToolCallDetailStatus,
): boolean {
  return toolName === "thinking" && (status === "running" || status === "executing");
}
