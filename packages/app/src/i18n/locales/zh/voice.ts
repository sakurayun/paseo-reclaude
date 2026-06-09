export default {
  dictation: {
    startAccessibilityLabel: "开始语音听写",
    cancelAccessibilityLabel: "取消听写",
    retryAccessibilityLabel: "重试听写",
    insertAccessibilityLabel: "插入转写文本",
    insertAndSendAccessibilityLabel: "插入转写文本并发送",
    failed: "听写失败。点按重试。",
    failedWithError: "听写失败：{{error}}",
  },
  overlay: {
    muteAccessibilityLabel: "静音语音模式",
    unmuteAccessibilityLabel: "取消静音语音模式",
    stopAccessibilityLabel: "停止语音模式并打断当前回合",
  },
} as const;
