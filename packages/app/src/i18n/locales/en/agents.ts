export default {
  list: {
    newSession: "New session",
    archivedBadge: "Archived",
    attentionBadge: "Attention",
    pendingPermissions_one: "{{count}} pending",
    pendingPermissions_other: "{{count}} pending",
    hostOffline: "Host offline",
    archiveRunningPrompt: "This agent is still running. Archiving it will stop the agent.",
    cancel: "Cancel",
    archive: "Archive",
  },
  dateSection: {
    today: "Today",
    yesterday: "Yesterday",
    thisWeek: "This week",
    thisMonth: "This month",
    older: "Older",
  },
  status: {
    bucket: {
      needsInput: "Needs input",
      failed: "Failed",
      readyToReview: "Ready to review",
      working: "Working",
      done: "Done",
    },
    lifecycle: {
      starting: "Starting",
      idle: "Idle",
      running: "Running",
      error: "Error",
      closed: "Closed",
    },
  },
  panel: {
    notFound: {
      title: "Agent not found",
    },
    loadError: {
      title: "Failed to load agent",
    },
    providerFallbackLabel: "Agent",
    providerSubtitle: "{{provider}} agent",
    reconnectingToast: "Reconnecting...",
    selectedHostFallback: "Selected host",
    archiving: {
      title: "Archiving agent...",
      subtitle: "Please wait while we archive this agent.",
    },
    unknownHost: {
      title: "Cannot open this agent because {{host}} is not configured on this device.",
      description: "Add the host in Settings or open an agent on a configured server to continue.",
    },
    preparingSession: "Preparing {{host}} session...",
    preparingSessionDescription: "We will show this agent in a moment.",
    connecting: "Connecting to {{host}}...",
    connectingDescription: "We will show this agent once the host is online.",
    reconnecting: "Reconnecting to {{host}}...",
    reconnectingDescription: "We will show this agent again as soon as the host is reachable.",
  },
  archived: {
    calloutText: "This agent is archived",
    unarchive: "Unarchive",
  },
  stream: {
    emptyState: "Start chatting with this agent...",
    scrollToBottom: "Scroll to bottom",
    proposedPlanTitle: "Proposed plan",
  },
  subagents: {
    archiveTooltip: "Archive subagent",
    archiveDialog: {
      fallbackLabel: "this subagent",
      runningTitle: "Archive running subagent?",
      title: "Archive subagent?",
      runningMessage:
        "{{label}} is still running. Archiving it will stop the subagent and remove it from the track.",
      message: "Remove {{label}} from the track. The subagent will be archived.",
      confirmLabel: "Archive",
      cancelLabel: "Cancel",
    },
  },
} as const;
