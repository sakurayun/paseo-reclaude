export default {
  message: {
    attachment: {
      review_one: "Review · {{count}} comment",
      review_other: "Review · {{count}} comments",
      pr: "PR #{{number}}",
      issue: "Issue #{{number}}",
      text: "Text attachment",
    },
    copyMessage: "Copy message",
    copyTurn: "Copy turn",
    copied: "Copied",
    workedFor: "Worked for {{duration}}",
    durationEndedAt: "{{duration}}, ended {{timestamp}}",
    imageUnavailable: "Image unavailable",
    imagePreviewUnavailable: "Image preview unavailable.",
    imageLoadFailed: "Unable to load image preview.",
    spoke: "Spoke",
    details: "Details",
    noTasks: "No tasks yet.",
    tasks: "Tasks",
    openFile: "Open file",
    plan: "Plan",
  },
  compaction: {
    compacting: "Compacting...",
    automatic: "Context automatically compacted",
    manual: "Context manually compacted",
    compacted: "Context compacted",
    compactedTokens: "Context compacted ({{count}}K tokens)",
  },
  toolCall: {
    error: "Error",
    emptyState: "No additional details available",
    worktreeSetup: {
      preparing: "Preparing worktree {{branchName}} at {{worktreePath}}",
    },
    subAgent: {
      activity: "Sub-agent activity",
      session: "session {{sessionId}}",
    },
    unknown: {
      input: "Input",
      output: "Output",
    },
  },
} as const;
