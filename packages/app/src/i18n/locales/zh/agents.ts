export default {
  list: {
    newSession: "新会话",
    archivedBadge: "已归档",
    attentionBadge: "需关注",
    pendingPermissions_one: "{{count}} 个待处理",
    pendingPermissions_other: "{{count}} 个待处理",
    hostOffline: "主机离线",
    archiveRunningPrompt: "该 Agent 仍在运行。归档将停止此 Agent。",
    cancel: "取消",
    archive: "归档",
  },
  dateSection: {
    today: "今天",
    yesterday: "昨天",
    thisWeek: "本周",
    thisMonth: "本月",
    older: "更早",
  },
  status: {
    bucket: {
      needsInput: "需要输入",
      failed: "失败",
      readyToReview: "待审查",
      working: "进行中",
      done: "已完成",
    },
    lifecycle: {
      starting: "启动中",
      idle: "空闲",
      running: "运行中",
      error: "错误",
      closed: "已关闭",
    },
  },
  panel: {
    notFound: {
      title: "未找到 Agent",
    },
    loadError: {
      title: "加载 Agent 失败",
    },
    providerFallbackLabel: "Agent",
    providerSubtitle: "{{provider}} Agent",
    reconnectingToast: "正在重新连接……",
    selectedHostFallback: "所选主机",
    archiving: {
      title: "正在归档 Agent……",
      subtitle: "正在归档此 Agent，请稍候。",
    },
    unknownHost: {
      title: "无法打开此 Agent，因为本设备尚未配置 {{host}}。",
      description: "请在“设置”中添加该主机，或在已配置的服务器上打开 Agent 以继续。",
    },
    preparingSession: "正在准备 {{host}} 会话……",
    preparingSessionDescription: "稍候即将显示此 Agent。",
    connecting: "正在连接到 {{host}}……",
    connectingDescription: "主机上线后将立即显示此 Agent。",
    reconnecting: "正在重新连接到 {{host}}……",
    reconnectingDescription: "主机可访问后将立即重新显示此 Agent。",
  },
  archived: {
    calloutText: "此 Agent 已归档",
    unarchive: "取消归档",
  },
  stream: {
    emptyState: "开始与此 Agent 对话……",
    scrollToBottom: "滚动到底部",
    proposedPlanTitle: "拟定计划",
  },
  subagents: {
    archiveTooltip: "归档子 Agent",
    archiveDialog: {
      fallbackLabel: "此子 Agent",
      runningTitle: "归档运行中的子 Agent？",
      title: "归档子 Agent？",
      runningMessage: "{{label}} 仍在运行。归档将停止该子 Agent 并将其从轨道中移除。",
      message: "将 {{label}} 从轨道中移除。该子 Agent 将被归档。",
      confirmLabel: "归档",
      cancelLabel: "取消",
    },
  },
} as const;
