export default {
  message: {
    attachment: {
      review_one: "评审 · {{count}} 条评论",
      review_other: "评审 · {{count}} 条评论",
      pr: "PR #{{number}}",
      issue: "Issue #{{number}}",
      text: "文本附件",
    },
    copyMessage: "复制消息",
    copyTurn: "复制本轮内容",
    copied: "已复制",
    workedFor: "用时 {{duration}}",
    durationEndedAt: "{{duration}}，结束于 {{timestamp}}",
    imageUnavailable: "图片不可用",
    imagePreviewUnavailable: "图片预览不可用。",
    imageLoadFailed: "无法加载图片预览。",
    spoke: "已朗读",
    details: "详情",
    noTasks: "暂无任务。",
    tasks: "任务",
    openFile: "打开文件",
    plan: "计划",
  },
  compaction: {
    compacting: "正在压缩…",
    automatic: "上下文已自动压缩",
    manual: "上下文已手动压缩",
    compacted: "上下文已压缩",
    compactedTokens: "上下文已压缩（{{count}}K token）",
  },
  toolCall: {
    error: "错误",
    emptyState: "暂无更多详情",
    worktreeSetup: {
      preparing: "正在准备工作区 {{branchName}}，位于 {{worktreePath}}",
    },
    subAgent: {
      activity: "子 Agent 活动",
      session: "会话 {{sessionId}}",
    },
    unknown: {
      input: "输入",
      output: "输出",
    },
  },
  fileLink: {
    notFound: "未找到与 {{token}} 对应的文件",
  },
  activityLog: {
    unknownError: "未知错误",
  },
} as const;
