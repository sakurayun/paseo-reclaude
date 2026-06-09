export default {
  dictation: {
    startAccessibilityLabel: "Start voice dictation",
    cancelAccessibilityLabel: "Cancel dictation",
    retryAccessibilityLabel: "Retry dictation",
    insertAccessibilityLabel: "Insert transcription",
    insertAndSendAccessibilityLabel: "Insert transcription and send",
    failed: "Dictation failed. Tap retry.",
    failedWithError: "Dictation failed: {{error}}",
  },
  overlay: {
    muteAccessibilityLabel: "Mute realtime voice",
    unmuteAccessibilityLabel: "Unmute realtime voice",
    stopAccessibilityLabel: "Stop realtime voice and interrupt turn",
  },
} as const;
