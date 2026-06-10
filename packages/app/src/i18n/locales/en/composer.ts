export default {
  main: {
    placeholder: {
      desktop: "Message the agent, tag @files, or use /commands and /skills",
      mobile: "Message, @files, /commands",
    },
    queue: {
      editAccessibilityLabel: "Edit queued message",
      sendNowAccessibilityLabel: "Send queued message now",
    },
    imageAttachment: {
      openAccessibilityLabel: "Open image attachment",
      removeAccessibilityLabel: "Remove image attachment",
    },
    githubAttachment: {
      kind: {
        issue: "issue",
      },
      openAccessibilityLabel: "Open {{kind}} #{{number}}",
      removeAccessibilityLabel: "Remove {{kind}} #{{number}}",
    },
    cancel: {
      cancelingAccessibilityLabel: "Canceling agent",
      stopAccessibilityLabel: "Stop agent",
      interruptTooltip: "Interrupt",
    },
    voice: {
      enableAccessibilityLabel: "Enable Voice mode",
      tooltip: "Voice mode",
    },
    attachMenu: {
      addImage: "Add image",
      addIssueOrPr: "Add issue or PR",
    },
    githubPicker: {
      searching: "Searching...",
      noResults: "No results found.",
      searchPlaceholder: "Search issues and PRs...",
      title: "Attach issue or PR",
    },
  },
  draft: {
    importPill: {
      accessibilityLabel: "Import session",
      label: "Import session",
    },
    agentTitle: "Agent",
  },
  controls: {
    hints: {
      thinking: "Thinking mode",
      model: "Change model",
      mode: "Change permission mode",
      gateway: "Model gateway",
    },
    gateway: {
      nativeLabel: "Native",
      fallbackLabel: "Model gateway",
      sheetTitle: "Model Gateway",
      selectAccessibilityLabel: "Select model gateway",
      selectAccessibilityLabelWithValue: "Select model gateway ({{value}})",
    },
    provider: {
      fallbackLabel: "Provider",
      selectAccessibilityLabel: "Select agent provider",
      unavailable: "Unavailable",
      unknownError: "Unknown error",
    },
    model: {
      selectAccessibilityLabel: "Select model",
      unknownLabel: "Unknown model",
    },
    mode: {
      sheetTitle: "Mode",
      searchPlaceholder: "Search modes...",
      selectAccessibilityLabelWithValue: "Select agent mode ({{value}})",
    },
    thinking: {
      sheetTitle: "Thinking",
      unknownLabel: "Unknown",
      selectAccessibilityLabel: "Select thinking option",
      selectAccessibilityLabelWithValue: "Select thinking option ({{value}})",
      levels: {
        low: "Low",
        medium: "Medium",
        high: "High",
        xhigh: "Extra high",
        max: "Max",
      },
    },
    features: {
      sheetTitle: "Features",
      openAccessibilityLabel: "Open agent features",
      toggleOn: "On",
      toggleOff: "Off",
      known: {
        fast_mode: {
          label: "Fast",
          description: "Lower latency responses at higher token cost",
          tooltip: "Toggle fast mode",
        },
        ultracode: {
          label: "Ultracode",
          description: "Use extra-high effort with Claude's dynamic workflow orchestration",
          tooltip: "Toggle Ultracode",
        },
      },
    },
  },
  input: {
    placeholder: "Message...",
    accessibilityLabel: "Message agent...",
    focusHint: "{{shortcut}} to focus",
    attachment: {
      sheetTitle: "Add attachment",
      addAccessibilityLabel: "Add attachment",
      addTooltip: "Add attachment",
    },
    send: {
      interruptAccessibilityLabel: "Interrupt agent",
      queueAccessibilityLabel: "Queue message",
      sendAndInterruptAccessibilityLabel: "Send and interrupt",
      sendAccessibilityLabel: "Send message",
      queueTooltip: "Queue",
      sendTooltip: "Send",
    },
    voice: {
      unmuteVoiceModeAccessibilityLabel: "Unmute Voice mode",
      muteVoiceModeAccessibilityLabel: "Mute Voice mode",
      stopDictationAccessibilityLabel: "Stop dictation",
      startDictationAccessibilityLabel: "Start dictation",
      unmuteVoiceTooltip: "Unmute voice",
      muteVoiceTooltip: "Mute voice",
      dictationTooltip: "Dictation",
      interruptBeforeVoiceModeError: "Interrupt the agent before starting voice mode",
    },
  },
  tabs: {
    hostNotConnectedError: "Host is not connected",
    selectModelError: "Select a model",
  },
  attachments: {
    elementLabel: "Element · {{tag}}",
    reviewLabelOne: "Review · 1 comment",
    reviewLabelOther: "Review · {{count}} comments",
    openBrowserElementAccessibilityLabel: "Open browser element attachment",
    openReviewAccessibilityLabel: "Open review attachment",
    removeBrowserElementAccessibilityLabel: "Remove browser element attachment",
    removeReviewAccessibilityLabel: "Remove review attachment",
  },
  flow: {
    noHostSelectedError: "No host selected",
    createAgentFailedError: "Failed to create agent",
    initialPromptRequiredError: "Initial prompt is required",
    sendMessageFailedError: "Failed to send message",
  },
} as const;
