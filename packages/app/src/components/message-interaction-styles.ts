export const USER_MESSAGE_CONTENT_DATA_SET = {
  paseoUserMessageContent: "true",
} as const;

export const USER_MESSAGE_TRAILING_ROW_DATA_SET = {
  paseoUserMessageTrailingRow: "true",
} as const;

export function installMessageInteractionStyles(): () => void {
  return () => {};
}
