export type Choice = "A" | "B";
export interface User {
  id: string;
  kind: "guest" | "registered";
  username: string | null;
  display_name: string;
  locale: string;
  region: string;
}
export interface Session {
  user: User | null;
  csrf_token: string | null;
}
export interface MergePreview {
  can_merge: boolean;
  merge_token: string | null;
  expires_at: string | null;
  target: { username: string; display_name: string };
  summary: {
    self_assessments: number;
    pulse_answers: number;
    friend_responses: number;
    friend_reservations: number;
    friend_invites: number;
    guesses: number;
    guess_links: number;
  };
  conflicts: { code: string; count: number; message: string }[];
  notice: string;
}
export interface Question {
  id: string;
  version: string;
  dimension?: string;
  prompt: string;
  choice_a: string;
  choice_b: string;
}
export interface Answer {
  question_id: string;
  choice: Choice;
}
let csrfToken: string | null = null;
export function setCsrfToken(token: string | null) {
  csrfToken = token;
}
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = "") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  if (
    options.method &&
    !["GET", "HEAD"].includes(options.method) &&
    !path.startsWith("/auth/") &&
    !path.startsWith("/session/") &&
    !headers.has("Idempotency-Key")
  )
    headers.set("Idempotency-Key", crypto.randomUUID());
  if (csrfToken && options.method && !["GET", "HEAD"].includes(options.method))
    headers.set("X-CSRF-Token", csrfToken);
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...options,
      headers,
      credentials: "include",
    });
  } catch {
    throw new ApiError("暂时连接不上 Nolya，请检查网络后再试。", 0);
  }
  const data =
    response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      data?.error?.message || data?.message || "操作未完成，请稍后重试。",
      response.status,
      data?.error?.code || "",
    );
  return data as T;
}
export function post<T>(path: string, body?: unknown) {
  return api<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
}
export function patch<T>(path: string, body?: unknown) {
  return api<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) });
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}
export interface SavedAnswer {
  id: string;
  question_id: string;
  choice: Choice;
  answered_at: string;
}
export interface SelfResult {
  id: string;
  version: string;
  created_at: string;
  answers: SavedAnswer[];
  dimensions: {
    dimension: string;
    score: -1 | 0 | 1;
    label: string;
    state: "stable" | "contextual";
  }[];
  observation_details?: {
    dimension: string;
    title: string;
    value: string;
    state: "stable" | "contextual";
    description: string;
  }[];
  observations: string[];
  summary: string;
  target_dimensions: string[];
}
export interface ShareLink {
  source_type?: "self" | "pulse" | "reverse";
  id: string;
  token: string;
  url: string;
  expires_at: string;
}
export interface Mirror {
  self_assessment_id: string | null;
  state: "empty" | "first" | "partial" | "full";
  completed_count: number;
  required_count: number;
  respondent_basis: string;
  identity_notice: string;
  target_dimensions: string[];
  comparisons: {
    dimension: string;
    self_score: number;
    self_label: string;
    a_count: number;
    b_count: number;
    sample_size: number;
    friend_label: string | null;
    consensus: string;
    relation: string;
  }[];
  insights: string[];
}
export interface FriendContext {
  type: "friends";
  owner_display_name: string;
  status: "active" | "expired" | "revoked" | "full";
  completed_count: number;
  max_respondents: number;
  already_submitted: boolean;
  is_owner: boolean;
  privacy_notice: string;
}
export interface FriendSession {
  session_id: string;
  question_bank_version: string;
  questions: Question[];
  already_submitted: boolean;
}
export interface Crowd {
  sample_size: number;
  mode: "insufficient" | "qualitative" | "percentage";
  majority: Choice | "tie" | null;
  a_percent: number | null;
  b_percent: number | null;
}
export interface PulseResult {
  id: string;
  date: string;
  region: string;
  timezone: string;
  question: Question;
  topic: string;
  answer: SavedAnswer | null;
  crowd: Crowd | null;
  saved_count: number;
}
export interface JournalEntry {
  answer_id: string;
  pulse_id: string;
  date: string;
  question: Question;
  choice: Choice;
  answered_at: string;
  share_eligible: boolean;
}
export interface SoloResult {
  answered_days: number;
  required_days: number;
  eligible: boolean;
  window_start: string | null;
  window_end: string | null;
  most_different: {
    entry: JournalEntry;
    same_choice_percent: number;
    sample_size: number;
  } | null;
  most_aligned: {
    entry: JournalEntry;
    same_choice_percent: number;
    sample_size: number;
  } | null;
  self_comparison: {
    dimension: string;
    kind: string;
    evidence_count: number;
    text: string;
  } | null;
  notice: string;
}
export interface Reveal {
  guessed_choice: Choice;
  actual_choice: Choice;
  correct: boolean;
  relationship: {
    correct_count: number;
    total_count: number;
    display_mode: string;
  };
  can_reverse: boolean;
}
export interface GuessContext {
  is_directed: boolean;
  id: string;
  owner_display_name: string;
  question: Question;
  status: "active" | "expired" | "revoked";
  is_owner: boolean;
  already_guessed: boolean;
  reveal: Reveal | null;
}
export interface Space {
  user: User;
  self: { completed: boolean; assessment_id: string | null };
  daily: {
    saved_count: number;
    answered_today: boolean;
    latest_answer_id: string | null;
  };
  friends: { completed_count: number; state: string };
  guesses: { created_count: number; received_count: number };
  guest_expires_at: string | null;
  capabilities: {
    can_invite: boolean;
    can_guess: boolean;
    can_register: boolean;
  };
}
export const newKey = () => crypto.randomUUID();
export function mutate<T>(path: string, body: unknown, key: string) {
  return api<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": key },
  });
}
export function shareUrl(link: ShareLink, kind: "friend" | "guess") {
  return `${window.location.origin}/${kind}/${encodeURIComponent(link.token)}`;
}
export function formatDate(date: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    timeZone: "Asia/Shanghai",
  }).format(new Date(date.length === 10 ? `${date}T12:00:00+08:00` : date));
}
