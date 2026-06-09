import type { TFunction } from "i18next";

import type {
  CheckoutPrStatusResponse,
  PullRequestTimelineResponse,
} from "@getpaseo/protocol/messages";
import i18n from "@/i18n";

export type PrState = "open" | "draft" | "merged" | "closed";
export type CheckStatus = "success" | "failure" | "pending" | "skipped";
export type ReviewState = "approved" | "changes_requested" | "commented";
export type ActivityKind = "review" | "comment";

export interface PrPaneCheck {
  name: string;
  workflow?: string;
  status: CheckStatus;
  duration?: string;
  url: string;
}

export interface PrPaneActivity {
  kind: ActivityKind;
  author: string;
  avatarColor: string;
  reviewState?: ReviewState;
  body: string;
  age: string;
  url: string;
}

export interface PrPaneData {
  number: number;
  title: string;
  state: PrState;
  url: string;
  reviewDecision: "approved" | "changes_requested" | "pending";
  awaitingReviewers: string[];
  checks: PrPaneCheck[];
  activity: PrPaneActivity[];
}

type CheckoutPrStatus = CheckoutPrStatusResponse["payload"]["status"];
type PullRequestTimeline = PullRequestTimelineResponse["payload"];
type PullRequestTimelineItem = PullRequestTimeline["items"][number];

const AVATAR_COLORS = [
  "#8b5cf6",
  "#f97316",
  "#0ea5e9",
  "#10b981",
  "#ef4444",
  "#eab308",
  "#ec4899",
  "#6366f1",
];

export function mapPrPaneData(
  status: CheckoutPrStatus,
  timeline: PullRequestTimeline | null | undefined,
  nowMs = Date.now(),
): PrPaneData | null {
  if (!status) {
    return null;
  }

  const number = status.number ?? parsePullRequestNumber(status.url);
  if (number === null) {
    return null;
  }

  const timelineMatchesStatus = timeline?.prNumber === number;

  return {
    number,
    title: status.title,
    state: derivePrState(status),
    url: status.url,
    reviewDecision: mapReviewDecision(status.reviewDecision),
    // Requested reviewers are intentionally unwired until the server exposes them.
    awaitingReviewers: [],
    checks: (status.checks ?? []).flatMap(mapCheck),
    activity: timelineMatchesStatus
      ? timeline.items.flatMap((item) => mapActivity(item, nowMs))
      : [],
  };
}

export function deriveAvatarColor(login: string): string {
  return AVATAR_COLORS[hashLogin(login) % AVATAR_COLORS.length];
}

export function formatAge(createdAtMs: number, nowMs = Date.now()): string {
  const elapsedMs = Math.max(0, nowMs - createdAtMs);
  const elapsedSeconds = Math.floor(elapsedMs / 1000);

  if (elapsedSeconds < 60) {
    return i18n.t("time:justNow");
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return i18n.t("time:relative.minutesAgo", { value: elapsedMinutes });
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return i18n.t("time:relative.hoursAgo", { value: elapsedHours });
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 30) {
    return i18n.t("time:relative.daysAgo", { value: elapsedDays });
  }

  if (elapsedDays < 365) {
    return i18n.t("time:relative.monthsAgo", { value: Math.floor(elapsedDays / 30) });
  }

  return i18n.t("time:relative.yearsAgo", { value: Math.floor(elapsedDays / 365) });
}

function derivePrState(status: NonNullable<CheckoutPrStatus>): PrState {
  if (status.isMerged || status.state === "merged") {
    return "merged";
  }
  if (status.state !== "open") {
    return "closed";
  }
  if (status.isDraft) {
    return "draft";
  }
  return "open";
}

function mapCheck(check: NonNullable<CheckoutPrStatus>["checks"][number]): PrPaneCheck[] {
  if (check.url === null) {
    return [];
  }

  return [
    {
      name: check.name,
      workflow: check.workflow,
      status: mapCheckStatus(check.status),
      duration: check.duration,
      url: check.url,
    },
  ];
}

function mapCheckStatus(status: string): CheckStatus {
  if (
    status === "success" ||
    status === "failure" ||
    status === "pending" ||
    status === "skipped"
  ) {
    return status;
  }
  if (status === "cancelled") {
    return "skipped";
  }
  return "pending";
}

function mapActivity(item: PullRequestTimelineItem, nowMs: number): PrPaneActivity[] {
  if (item.kind === "comment") {
    if (item.body.trim() === "") {
      return [];
    }
    return [
      {
        kind: "comment",
        author: item.author,
        avatarColor: deriveAvatarColor(item.author),
        body: item.body,
        age: formatAge(item.createdAt, nowMs),
        url: item.url,
      },
    ];
  }

  if (item.reviewState === "commented" && item.body.trim() === "") {
    return [];
  }

  return [
    {
      kind: "review",
      author: item.author,
      avatarColor: deriveAvatarColor(item.author),
      reviewState: item.reviewState,
      body: item.body,
      age: formatAge(item.createdAt, nowMs),
      url: item.url,
    },
  ];
}

function mapReviewDecision(
  reviewDecision: NonNullable<CheckoutPrStatus>["reviewDecision"],
): PrPaneData["reviewDecision"] {
  if (reviewDecision === "approved" || reviewDecision === "changes_requested") {
    return reviewDecision;
  }
  return "pending";
}

function parsePullRequestNumber(url: string): number | null {
  try {
    const match = new URL(url).pathname.match(/\/pull\/(\d+)(?:\/|$)/);
    if (!match) {
      return null;
    }

    const number = Number.parseInt(match[1], 10);
    return Number.isFinite(number) ? number : null;
  } catch {
    return null;
  }
}

function hashLogin(login: string): number {
  let hash = 0;
  for (const character of login.toLowerCase()) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash;
}

export function getStateLabel(state: PrState, t: TFunction<"git">): string {
  if (state === "draft") return t("pr.state.draft");
  if (state === "merged") return t("pr.state.merged");
  if (state === "closed") return t("pr.state.closed");
  return t("pr.state.open");
}

export function getActivityVerb(
  item: Pick<PrPaneActivity, "kind" | "reviewState">,
  t: TFunction<"git">,
): string {
  if (item.kind === "comment") return t("pr.activity.commented");
  if (item.reviewState === "approved") return t("pr.activity.approved");
  if (item.reviewState === "changes_requested") return t("pr.activity.requestedChanges");
  return t("pr.activity.reviewed");
}
