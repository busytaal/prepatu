/**
 * Artifact and transcript type system.
 *
 * Groundwork for Eventually LLM: artifacts arrive over the lobby WebSocket
 * and replace (or augment) the transcript in ArtifactArea without interrupting
 * the voice pipeline.
 *
 * ArtifactRendererRegistry lets apps register custom renderers so the SDK stays
 * generic while application-specific cards (vocabulary, score, cue-card, etc.)
 * can be injected by the app layer.
 */

import type React from "react";

// ── Transcript ────────────────────────────────────────────────────────────────

export type TranscriptEntry = {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
};

// ── Artifact union ────────────────────────────────────────────────────────────

type BaseArtifact = {
  id: string;
  /**
   * The transcript turn ID that triggered this artifact.
   * Frontend uses this to discard artifacts that arrived too late
   * (conversation has moved past this context).
   */
  contextTurnId?: string;
};

/** Rich info card — vocabulary word, grammar tip, factoid, etc. */
export type CardArtifact = BaseArtifact & {
  type: "card";
  cardType: "vocabulary" | "grammar" | "score" | "tip" | "info" | "cue_card";
  title?: string;
  content: Record<string, unknown>;
};

/** Tappable / speakable options list — presented to the user for selection. */
export type OptionsArtifact = BaseArtifact & {
  type: "options";
  prompt?: string;
  options: Array<{ id: string; label: string; description?: string }>;
};

/** Inline feedback — correction, pronunciation score, annotation on user's speech. */
export type FeedbackArtifact = BaseArtifact & {
  type: "feedback";
  feedbackType: "correction" | "score" | "annotation";
  content: Record<string, unknown>;
};

/**
 * Navigation command — Eventually LLM steers the view.
 * Handled by the navigation layer; ArtifactArea does not render it.
 */
export type NavigateArtifact = BaseArtifact & {
  type: "navigate";
  screen: string;
  params?: Record<string, unknown>;
};

/** Dismiss a previously shown artifact (or all artifacts). */
export type DismissArtifact = BaseArtifact & {
  type: "dismiss";
  targetId?: string;
};

export type FormField = {
  id: string;
  type: "text" | "number" | "email";
  label: string;
  placeholder?: string;
  required?: boolean;
};

export type FormArtifact = BaseArtifact & {
  type: "form";
  prompt?: string;
  fields: FormField[];
  options?: Array<{ id: string; label: string; description?: string }>;
};

export type OrbLayoutArtifact = BaseArtifact & {
  type: "orb_layout";
  position: "center" | "bottom" | "bottom_right" | "top_right";
};

export type IntentArtifact = BaseArtifact & {
  type: "intent";
  text: string;
};

/**
 * Server-driven form field population.
 *
 * Emitted automatically by the flow engine when a variable is captured
 * (via voice or tool call) and the current state has a form field whose
 * `id` matches the variable name.  The client must update the corresponding
 * input value without any user interaction.
 *
 * YAML contract: form field `id` must equal the flow variable name.
 */
export type FieldUpdateArtifact = BaseArtifact & {
  type: "field_update";
  field_id: string;
  value: string;
};

export type Artifact =
  | CardArtifact
  | OptionsArtifact
  | FeedbackArtifact
  | NavigateArtifact
  | DismissArtifact
  | FormArtifact
  | OrbLayoutArtifact
  | IntentArtifact
  | FieldUpdateArtifact;

// ── Lobby WebSocket message shapes ───────────────────────────────────────────

/** Artifact message arriving from Eventually LLM over lobby WS. */
export type ArtifactMessage = {
  type: "artifact";
  tool: string;
  id: string;
  payload: unknown;
};

/** User action (e.g. tapped an option) sent back to lobby WS. */
export type UserActionMessage = {
  type: "user_action";
  artifactId: string;
  action: string;
  value?: unknown;
};

// ── Renderer registry ─────────────────────────────────────────────────────────

/**
 * A renderer for a specific artifact type.
 * Receives the artifact and an `onAction` callback for user interactions.
 */
export type ArtifactRenderer<T extends Artifact = Artifact> = (
  artifact: T,
  onAction: (action: string, value?: unknown) => void
) => React.ReactElement | null;

/**
 * Registry of renderers keyed by artifact type.
 * Pass one to VoiceScreen (or ArtifactArea) to override default stubs.
 */
export type ArtifactRendererRegistry = Partial<{
  [K in Artifact["type"]]: ArtifactRenderer<Extract<Artifact, { type: K }>>;
}>;
