export default {
  main: {
    placeholder: {
      desktop: "给 Agent 发消息，用 @files 引用文件，或使用 /commands 和 /skills",
      mobile: "发消息、@files、/commands",
    },
    queue: {
      editAccessibilityLabel: "编辑排队消息",
      sendNowAccessibilityLabel: "立即发送排队消息",
    },
    imageAttachment: {
      openAccessibilityLabel: "打开图片附件",
      removeAccessibilityLabel: "移除图片附件",
    },
    githubAttachment: {
      kind: {
        issue: "issue",
      },
      openAccessibilityLabel: "打开 {{kind}} #{{number}}",
      removeAccessibilityLabel: "移除 {{kind}} #{{number}}",
    },
    cancel: {
      cancelingAccessibilityLabel: "正在取消 Agent",
      stopAccessibilityLabel: "停止 Agent",
      interruptTooltip: "中断",
    },
    voice: {
      enableAccessibilityLabel: "启用语音模式",
      tooltip: "语音模式",
    },
    attachMenu: {
      addImage: "添加图片",
      addIssueOrPr: "添加 issue 或 PR",
    },
    githubPicker: {
      searching: "搜索中…",
      noResults: "未找到结果。",
      searchPlaceholder: "搜索 issue 和 PR…",
      title: "附加 issue 或 PR",
    },
  },
  draft: {
    importPill: {
      accessibilityLabel: "导入会话",
      label: "导入会话",
    },
  },
  controls: {
    provider: {
      fallbackLabel: "提供方",
      selectAccessibilityLabel: "选择 Agent 提供方",
    },
    model: {
      selectAccessibilityLabel: "选择模型",
    },
    mode: {
      sheetTitle: "模式",
      searchPlaceholder: "搜索模式...",
      selectAccessibilityLabelWithValue: "选择 Agent 模式（{{value}}）",
    },
    thinking: {
      sheetTitle: "思考",
      unknownLabel: "未知",
      selectAccessibilityLabel: "选择思考选项",
      selectAccessibilityLabelWithValue: "选择思考选项（{{value}}）",
    },
    features: {
      sheetTitle: "功能",
      openAccessibilityLabel: "打开 Agent 功能",
      toggleOn: "开",
      toggleOff: "关",
    },
  },
  input: {
    placeholder: "输入消息…",
    accessibilityLabel: "向 Agent 发送消息…",
    focusHint: "{{shortcut}} 聚焦",
    attachment: {
      sheetTitle: "添加附件",
      addAccessibilityLabel: "添加附件",
      addTooltip: "添加附件",
    },
    send: {
      interruptAccessibilityLabel: "中断 Agent",
      queueAccessibilityLabel: "排队消息",
      sendAndInterruptAccessibilityLabel: "发送并中断",
      sendAccessibilityLabel: "发送消息",
      queueTooltip: "排队",
      sendTooltip: "发送",
    },
    voice: {
      unmuteVoiceModeAccessibilityLabel: "取消静音语音模式",
      muteVoiceModeAccessibilityLabel: "静音语音模式",
      stopDictationAccessibilityLabel: "停止听写",
      startDictationAccessibilityLabel: "开始听写",
      unmuteVoiceTooltip: "取消静音",
      muteVoiceTooltip: "静音",
      dictationTooltip: "听写",
      interruptBeforeVoiceModeError: "请先中断 Agent，再启动语音模式",
    },
  },
  tabs: {
    hostNotConnectedError: "主机未连接",
    selectModelError: "请选择一个模型",
  },
  attachments: {
    elementLabel: "元素 · {{tag}}",
    reviewLabelOne: "审查 · 1 条评论",
    reviewLabelOther: "审查 · {{count}} 条评论",
    openBrowserElementAccessibilityLabel: "打开浏览器元素附件",
    openReviewAccessibilityLabel: "打开审查附件",
    removeBrowserElementAccessibilityLabel: "移除浏览器元素附件",
    removeReviewAccessibilityLabel: "移除审查附件",
  },
  flow: {
    noHostSelectedError: "未选择主机",
    createAgentFailedError: "创建 Agent 失败",
    initialPromptRequiredError: "需要填写初始提示词",
    sendMessageFailedError: "发送消息失败",
  },
} as const;
