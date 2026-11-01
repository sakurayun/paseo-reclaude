import { Alert } from "@/components/ui/alert";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useState, useCallback, useMemo, useRef, type RefObject } from "react";
import {
  View,
  Text,
  Pressable,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Check, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { PendingPermission } from "@/types/shared";
import type { AgentPermissionResponse } from "@getpaseo/protocol/agent-types";
import { isWeb } from "@/constants/platform";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import type { EditingTextInputHandle } from "@/components/ui/text-input/types";
import { ScrollableCodeSurface } from "@/components/ui/scrollable-code-surface";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import {
  areQuestionsAnswered,
  buildQuestionFormAnswers,
  isQuestionAnswered,
  parseQuestionFormQuestions,
  questionShowsTextInput,
  resolveDismissLabel,
  shouldSubmitEmptyOnDismiss,
  type QuestionFormQuestion,
  type QuestionOption,
} from "./question-form-card-core";

interface QuestionFormCardProps {
  permission: PendingPermission;
  onRespond: (response: AgentPermissionResponse) => void;
  isResponding: boolean;
  responseError: string | null;
}

const IS_WEB = isWeb;
// Native previews are uncapped: inside the option's Pressable, Android never hands a
// drag to the preview's nested scroll, so lines past a cap would be unreachable.
const OPTION_PREVIEW_MAX_HEIGHT = IS_WEB ? 240 : undefined;

// Web clicks that must not answer: a link in the label, anything in the description, and the
// second click of a double-click, which would otherwise land on the next question's options.
function isNonAnsweringClick(event: GestureResponderEvent, description: View | null): boolean {
  if (!IS_WEB) return false;
  const click = event.nativeEvent as unknown as MouseEvent;
  if (click.detail > 1) return true;
  const target = click.target as Element | null;
  const descriptionElement = description as unknown as Element | null;
  return Boolean(target?.closest("a") || descriptionElement?.contains(target));
}

// The description is selectable text, so a touch on it belongs to the text, not the option.
const claimResponder = () => true;

function getQuestionInputPlaceholder({
  question,
  answerPlaceholder,
  otherPlaceholder,
}: {
  question: QuestionFormQuestion;
  answerPlaceholder: string;
  otherPlaceholder: string;
}): string {
  return (
    question.placeholder ?? (question.options.length === 0 ? answerPlaceholder : otherPlaceholder)
  );
}

interface QuestionOptionRowProps {
  qIndex: number;
  optIndex: number;
  option: QuestionOption;
  isSelected: boolean;
  multiSelect: boolean;
  isResponding: boolean;
  onToggle: (qIndex: number, optIndex: number, multiSelect: boolean) => void;
}

function QuestionOptionRow({
  qIndex,
  optIndex,
  option,
  isSelected,
  multiSelect,
  isResponding,
  onToggle,
}: QuestionOptionRowProps) {
  const { theme } = useUnistyles();

  const descriptionRef = useRef<View>(null);
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      if (isNonAnsweringClick(event, descriptionRef.current)) return;
      onToggle(qIndex, optIndex, multiSelect);
    },
    [onToggle, qIndex, optIndex, multiSelect],
  );

  const pressableStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.optionItem,
      (Boolean(hovered) || isSelected) && {
        backgroundColor: theme.colors.surface2,
      },
      pressed && styles.optionItemPressed,
    ],
    [isSelected, theme.colors.surface2],
  );

  const accessibilityState = useMemo(() => ({ checked: isSelected }), [isSelected]);

  return (
    <Pressable
      style={pressableStyle}
      onPress={handlePress}
      disabled={isResponding}
      accessibilityRole="button"
      accessibilityLabel={option.label}
      accessibilityState={accessibilityState}
      aria-checked={isSelected}
    >
      <View style={styles.optionItemContent}>
        <View style={styles.optionTextBlock}>
          <MarkdownRenderer text={option.label} compact muted={!isSelected} selectable={false} />
          {option.description ? (
            <View
              ref={descriptionRef}
              testID="question-form-option-description"
              onStartShouldSetResponder={claimResponder}
            >
              <MarkdownRenderer text={option.description} compact muted />
            </View>
          ) : null}
          {option.preview ? (
            // Shown for every option at once so they can be compared before picking.
            // Long lines wrap, as in Claude Code, since most previews are prose.
            <ScrollableCodeSurface
              tone="surface0"
              maxHeight={OPTION_PREVIEW_MAX_HEIGHT}
              horizontal={false}
              selectable={false}
              textStyle={styles.optionPreviewText}
              testID="question-form-option-preview"
            >
              {option.preview}
            </ScrollableCodeSurface>
          ) : null}
        </View>
        {isSelected ? (
          <View style={styles.optionCheckSlot}>
            <Check size={16} color={theme.colors.foregroundMuted} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

interface QuestionNavButtonProps {
  index: number;
  total: number;
  isActive: boolean;
  isResponding: boolean;
  onSelect: (index: number) => void;
}

function QuestionNavButton({
  index,
  total,
  isActive,
  isResponding,
  onSelect,
}: QuestionNavButtonProps) {
  const { theme } = useUnistyles();
  const accessibilityState = useMemo(() => ({ selected: isActive }), [isActive]);
  const handlePress = useCallback(() => {
    onSelect(index);
  }, [index, onSelect]);
  const pressableStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => {
      return [
        styles.questionNavButton,
        {
          backgroundColor:
            isActive || Boolean(hovered) ? theme.colors.surface2 : theme.colors.surface1,
          borderColor: isActive ? theme.colors.foregroundMuted : theme.colors.border,
        },
        pressed && styles.optionItemPressed,
      ];
    },
    [
      isActive,
      theme.colors.border,
      theme.colors.foregroundMuted,
      theme.colors.surface1,
      theme.colors.surface2,
    ],
  );
  const textStyle = useMemo(
    () => [
      styles.questionNavText,
      { color: isActive ? theme.colors.foreground : theme.colors.foregroundMuted },
    ],
    [isActive, theme.colors.foreground, theme.colors.foregroundMuted],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Question ${index + 1} of ${total}`}
      accessibilityState={accessibilityState}
      aria-selected={isActive}
      testID={`question-form-question-nav-${index + 1}`}
      style={pressableStyle}
      onPress={handlePress}
      disabled={isResponding}
    >
      <Text style={textStyle}>{index + 1}</Text>
    </Pressable>
  );
}

interface QuestionOtherInputProps {
  qIndex: number;
  inputRef: RefObject<EditingTextInputHandle | null>;
  accessibilityLabel: string;
  value: string;
  placeholder: string;
  isResponding: boolean;
  onChange: (qIndex: number, text: string) => void;
  onSubmit: () => void;
}

function QuestionOtherInput({
  qIndex,
  inputRef,
  accessibilityLabel,
  value,
  placeholder,
  isResponding,
  onChange,
  onSubmit,
}: QuestionOtherInputProps) {
  const { theme } = useUnistyles();
  const handleChange = useCallback(
    (text: string) => {
      onChange(qIndex, text);
    },
    [onChange, qIndex],
  );
  const otherInputStyle = useMemo(
    () =>
      [
        styles.otherInput,
        {
          borderColor: value.length > 0 ? theme.colors.borderAccent : theme.colors.border,
          color: theme.colors.foreground,
          backgroundColor: theme.colors.surface2,
        },
        IS_WEB ? { outlineStyle: "none", outlineWidth: 0, outlineColor: "transparent" } : null,
      ] as const,
    [
      value.length,
      theme.colors.borderAccent,
      theme.colors.border,
      theme.colors.foreground,
      theme.colors.surface2,
    ],
  );
  return (
    <TextInput
      ref={inputRef}
      // @ts-expect-error - outlineStyle is web-only
      style={otherInputStyle}
      accessibilityLabel={accessibilityLabel}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.foregroundMuted}
      initialValue={value}
      onChangeText={handleChange}
      onSubmitEditing={onSubmit}
      editable={!isResponding}
      blurOnSubmit={false}
    />
  );
}

export function QuestionFormCard({
  permission,
  onRespond,
  isResponding,
  responseError,
}: QuestionFormCardProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const isMobile = useIsCompactFormFactor();
  const questions = useMemo(
    () => parseQuestionFormQuestions(permission.request.input),
    [permission.request.input],
  );

  const [selections, setSelections] = useState<Record<number, Set<number>>>({});
  const [otherTexts, setOtherTexts] = useState<Record<number, string>>({});
  const otherInputRef = useRef<EditingTextInputHandle | null>(null);
  const [respondingAction, setRespondingAction] = useState<"submit" | "dismiss" | null>(null);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);

  const toggleOption = useCallback(
    (qIndex: number, optIndex: number, multiSelect: boolean) => {
      const current = selections[qIndex] ?? new Set<number>();
      const next = new Set(current);
      if (multiSelect) {
        if (next.has(optIndex)) {
          next.delete(optIndex);
        } else {
          next.add(optIndex);
        }
      } else if (next.has(optIndex)) {
        next.clear();
      } else {
        next.clear();
        next.add(optIndex);
      }

      setSelections((prev) => ({ ...prev, [qIndex]: next }));

      // Single-select: an option and a custom answer replace each other, as in Claude Code.
      // Multi-select keeps both. The editing surface owns its text and never replays state
      // (docs/forms.md), so clearing state alone would leave stale text on screen that
      // submit ignores; clear the surface explicitly.
      if (!multiSelect && otherTexts[qIndex]) {
        setOtherTexts((prev) => {
          const nextTexts = { ...prev };
          delete nextTexts[qIndex];
          return nextTexts;
        });
        otherInputRef.current?.replaceText("");
      }

      if (!multiSelect && next.size > 0 && qIndex === activeQuestionIndex && questions) {
        setActiveQuestionIndex(Math.min(qIndex + 1, questions.length - 1));
      }
    },
    [activeQuestionIndex, otherTexts, questions, selections],
  );

  const setOtherText = useCallback(
    (qIndex: number, text: string) => {
      setOtherTexts((prev) => ({ ...prev, [qIndex]: text }));
      const multiSelect = questions?.[qIndex]?.multiSelect ?? false;
      if (!multiSelect && text.length > 0) {
        setSelections((prev) => {
          if (!prev[qIndex] || prev[qIndex].size === 0) return prev;
          return { ...prev, [qIndex]: new Set<number>() };
        });
      }
    },
    [questions],
  );

  const allAnswered = areQuestionsAnswered(questions, selections, otherTexts);
  const resolvedActiveQuestionIndex = questions
    ? Math.min(activeQuestionIndex, questions.length - 1)
    : 0;
  const activeQuestion = questions?.[resolvedActiveQuestionIndex];
  const activeQuestionAnswered = activeQuestion
    ? isQuestionAnswered(activeQuestion, resolvedActiveQuestionIndex, selections, otherTexts)
    : false;
  const isLastQuestion = questions ? resolvedActiveQuestionIndex === questions.length - 1 : true;

  const handleSubmit = useCallback(() => {
    if (!questions || !allAnswered || isResponding) return;
    setRespondingAction("submit");
    onRespond({
      behavior: "allow",
      updatedInput: {
        ...permission.request.input,
        answers: buildQuestionFormAnswers(questions, selections, otherTexts),
      },
    });
  }, [
    questions,
    allAnswered,
    isResponding,
    selections,
    otherTexts,
    onRespond,
    permission.request.input,
  ]);

  const handleDeny = useCallback(() => {
    if (!questions || isResponding) return;
    setRespondingAction("dismiss");
    if (shouldSubmitEmptyOnDismiss(questions)) {
      onRespond({
        behavior: "allow",
        updatedInput: {
          ...permission.request.input,
          answers: buildQuestionFormAnswers(questions, selections, otherTexts),
        },
      });
      return;
    }
    onRespond({
      behavior: "deny",
      message: "Dismissed by user",
    });
  }, [questions, isResponding, onRespond, otherTexts, permission.request.input, selections]);

  const handleSelectQuestion = useCallback((index: number) => {
    setActiveQuestionIndex(index);
  }, []);

  const handlePrimaryAction = useCallback(() => {
    if (!isLastQuestion) {
      if (!activeQuestionAnswered || isResponding) return;
      setActiveQuestionIndex((index) => Math.min(index + 1, (questions?.length ?? 1) - 1));
      return;
    }
    handleSubmit();
  }, [activeQuestionAnswered, handleSubmit, isLastQuestion, isResponding, questions?.length]);

  const dismissButtonStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.actionButton,
      {
        backgroundColor: hovered ? theme.colors.surface2 : theme.colors.surface1,
        borderColor: theme.colors.borderAccent,
      },
      pressed && styles.optionItemPressed,
    ],
    [theme.colors.surface2, theme.colors.surface1, theme.colors.borderAccent],
  );

  const pendingAction = isResponding ? respondingAction : null;
  const primaryDisabled = isResponding || (isLastQuestion ? !allAnswered : !activeQuestionAnswered);
  const primaryActionLabel = isLastQuestion
    ? t("message.question.submit")
    : t("message.question.next");
  const submitButtonStyle = useCallback(
    ({ pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.actionButton,
      {
        backgroundColor: theme.colors.accent,
        borderColor: theme.colors.accent,
        opacity: primaryDisabled ? 0.5 : 1,
      },
      pressed && !primaryDisabled ? styles.optionItemPressed : null,
    ],
    [primaryDisabled, theme.colors.accent],
  );

  const containerStyle = useMemo(
    () => [
      styles.container,
      {
        backgroundColor: theme.colors.surface1,
        borderColor: theme.colors.border,
      },
    ],
    [theme.colors.surface1, theme.colors.border],
  );
  const questionTextStyle = useMemo(
    () => [styles.questionText, { color: theme.colors.foreground }],
    [theme.colors.foreground],
  );
  const questionNavStyle = useMemo(
    () => [styles.questionNav, isMobile && styles.questionNavMobile],
    [isMobile],
  );
  // Single-select radios need a group; checkboxes are valid standalone.
  const optionsGroupAccessibility = useMemo(
    () =>
      activeQuestion && !activeQuestion.multiSelect
        ? ({
            accessibilityRole: "radiogroup",
            accessibilityLabel: activeQuestion.question,
          } as const)
        : {},
    [activeQuestion],
  );
  const actionsContainerStyle = useMemo(
    () => [styles.actionsContainer, !isMobile && styles.actionsContainerDesktop],
    [isMobile],
  );
  const dismissActionTextStyle = useMemo(
    () => [styles.actionText, { color: theme.colors.foregroundMuted }],
    [theme.colors.foregroundMuted],
  );
  const submitActionTextColor = theme.colors.accentForeground;
  const submitActionTextStyle = useMemo(
    () => [styles.actionText, { color: submitActionTextColor }],
    [submitActionTextColor],
  );

  if (!questions) {
    return null;
  }

  const dismissLabel = resolveDismissLabel(questions, t("common.actions.dismiss"));
  const selected = selections[resolvedActiveQuestionIndex] ?? new Set<number>();
  const otherText = otherTexts[resolvedActiveQuestionIndex] ?? "";
  const showTextInput = questionShowsTextInput(questions[resolvedActiveQuestionIndex]);

  return (
    <View style={containerStyle} testID="question-form-card">
      <View style={styles.questionTopRow}>
        <View style={styles.questionHeader}>
          <Text testID="question-form-current-question" style={questionTextStyle}>
            {activeQuestion?.question}
          </Text>
        </View>
        <View style={questionNavStyle} testID="question-form-question-nav">
          {questions.map((question, qIndex) => {
            const isActive = qIndex === resolvedActiveQuestionIndex;
            return (
              <QuestionNavButton
                key={question.header}
                index={qIndex}
                total={questions.length}
                isActive={isActive}
                isResponding={isResponding}
                onSelect={handleSelectQuestion}
              />
            );
          })}
        </View>
      </View>

      {activeQuestion ? (
        <View key={activeQuestion.question} style={styles.questionBlock}>
          {activeQuestion.options.length > 0 ? (
            <View style={styles.optionsWrap} {...optionsGroupAccessibility}>
              {activeQuestion.options.map((opt, optIndex) => (
                <QuestionOptionRow
                  key={opt.label}
                  qIndex={resolvedActiveQuestionIndex}
                  optIndex={optIndex}
                  option={opt}
                  isSelected={selected.has(optIndex)}
                  multiSelect={activeQuestion.multiSelect}
                  isResponding={isResponding}
                  onToggle={toggleOption}
                />
              ))}
            </View>
          ) : null}
          {showTextInput ? (
            <QuestionOtherInput
              qIndex={resolvedActiveQuestionIndex}
              inputRef={otherInputRef}
              accessibilityLabel={activeQuestion.question}
              value={otherText}
              placeholder={getQuestionInputPlaceholder({
                question: activeQuestion,
                answerPlaceholder: t("message.question.answerPlaceholder"),
                otherPlaceholder: t("message.question.otherPlaceholder"),
              })}
              isResponding={isResponding}
              onChange={setOtherText}
              onSubmit={handlePrimaryAction}
            />
          ) : null}
        </View>
      ) : null}

      {responseError ? <Alert variant="error" description={responseError} size="sm" /> : null}

      <View style={actionsContainerStyle}>
        <Pressable
          style={dismissButtonStyle}
          onPress={handleDeny}
          disabled={isResponding}
          accessibilityRole="button"
          accessibilityLabel={dismissLabel}
          testID="question-form-dismiss"
        >
          {pendingAction === "dismiss" ? (
            <LoadingSpinner size="small" color={theme.colors.foregroundMuted} />
          ) : (
            <View style={styles.actionContent}>
              <X size={14} color={theme.colors.foregroundMuted} />
              <Text style={dismissActionTextStyle}>{dismissLabel}</Text>
            </View>
          )}
        </Pressable>

        <Pressable
          style={submitButtonStyle}
          onPress={handlePrimaryAction}
          disabled={primaryDisabled}
          accessibilityRole="button"
          accessibilityLabel={primaryActionLabel}
          testID="question-form-primary-action"
        >
          {pendingAction === "submit" ? (
            <LoadingSpinner size="small" color={theme.colors.accentForeground} />
          ) : (
            <View style={styles.actionContent}>
              <Check size={14} color={submitActionTextColor} />
              <Text style={submitActionTextStyle}>{primaryActionLabel}</Text>
            </View>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[3],
    ...theme.shadow.sm,
  },
  questionBlock: {
    gap: theme.spacing[2],
  },
  questionTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  questionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[1],
    flex: 1,
  },
  questionText: {
    flex: 1,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    lineHeight: Math.round(theme.fontSize.base * 1.4),
  },
  optionsWrap: {
    gap: theme.spacing[1],
  },
  questionNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[1],
  },
  questionNavMobile: {
    paddingRight: theme.spacing[1],
  },
  questionNavButton: {
    minWidth: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: theme.shell.controlBorder,
  },
  questionNavText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
  },
  optionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  optionItemPressed: {
    opacity: 0.9,
  },
  optionItemContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  optionTextBlock: {
    flex: 1,
    gap: 2,
  },
  optionPreviewText: {
    lineHeight: 20,
    ...(isWeb ? { whiteSpace: "pre-wrap", overflowWrap: "break-word" } : null),
  },
  optionCheckSlot: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: "auto",
  },
  otherInput: {
    borderWidth: theme.shell.controlBorder,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    fontSize: theme.fontSize.base,
  },
  actionsContainer: {
    gap: theme.spacing[2],
  },
  actionsContainerDesktop: {
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "center",
  },
  actionButton: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    borderWidth: theme.shell.controlBorder,
  },
  actionContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionText: {
    fontSize: theme.fontSize.base,
  },
}));
