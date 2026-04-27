/**
 * Prepatu Design Tokens
 *
 * Voice-first mobile design system.
 *
 * Core metaphor: the Orb's POSITION communicates the interaction contract.
 *   side-anchored  → assistant mode  ("I am at your service")
 *   centred        → interview mode  ("you answer to me")
 */

// ─────────────────────────────────────────────────────────────────────────────
// Palette
// ─────────────────────────────────────────────────────────────────────────────

export const colors = {
  // ── Backgrounds ──────────────────────────────────────────────────────────
  background: {
    /** Primary app background — deep near-black */
    base:       "#0A0A14",
    /** Slightly raised surface (cards, overlays) */
    surface:    "#12121E",
    /** Elevated surface — modals, action sheets */
    elevated:   "#1A1A28",
  },

  // ── Orb states ───────────────────────────────────────────────────────────
  orb: {
    idle:       "#3A3A4A",
    connecting: "#E8A020",
    connected:  "#4A90E2",
    /** VAD active — mic is open, agent is waiting for the user to speak */
    listening:  "#3ECF6A",
    /** Agent TTS is playing */
    speaking:   "#4A90E2",
    error:      "#E74C3C",
    ended:      "#3A3A4A",
    /** Mic is muted but session is active */
    mutedMic:   "#7A7A8A",
    /** Speaker is muted */
    mutedSpk:   "#7A7A8A",
  },

  // ── Glow / halo (cast behind the orb) ───────────────────────────────────
  glow: {
    idle:       "rgba(58,58,74,0.00)",
    connecting: "rgba(232,160,32,0.22)",
    connected:  "rgba(74,144,226,0.22)",
    listening:  "rgba(62,207,106,0.30)",
    speaking:   "rgba(74,144,226,0.38)",
    error:      "rgba(231,76,60,0.28)",
    ended:      "rgba(58,58,74,0.00)",
    mutedMic:   "rgba(122,122,138,0.15)",
    mutedSpk:   "rgba(122,122,138,0.15)",
  },

  // ── Listening ring ───────────────────────────────────────────────────────
  /** Thin animated ring shown ONLY during `listening` state */
  listeningRing:       "#3ECF6A",
  listeningRingFaded:  "rgba(62,207,106,0.12)",

  // ── Typography ───────────────────────────────────────────────────────────
  text: {
    primary:   "#FFFFFF",
    secondary: "#A0A0B8",
    muted:     "#444458",
    intent:    "#FFFFFF",      // large intent label — full white
    transcript:"#6B6B80",      // raw transcript — low contrast, background info
    badge:     "#FFFFFF",
    timer:     "#A0A0B8",
    error:     "#E74C3C",
  },

  // ── Action buttons (artifact actions) ───────────────────────────────────
  action: {
    /** Default pill background */
    bg:         "#1E1E30",
    /** Border / slight edge definition */
    border:     "#2E2E44",
    /** Label */
    label:      "#C0C0D8",
    /** Pressed state */
    bgPressed:  "#2A2A3E",
    /** Destructive / end-session button */
    bgDanger:   "#2A1A1A",
    labelDanger:"#E74C3C",
  },

  // ── Mute controls ────────────────────────────────────────────────────────
  mute: {
    /** Inactive (not muted) icon tint */
    active:   "#6B6B80",
    /** Muted — icon turns this colour to signal suppression */
    muted:    "#E8A020",
    /** Background pill when muted */
    mutedBg:  "rgba(232,160,32,0.12)",
  },

  // ── Form field — LLM-update flash ─────────────────────────────────────────
  /**
   * Shown when the backend/LLM auto-fills or corrects a form field.
   * A brief green glow + border highlights the changed input.
   */
  fieldUpdate: {
    /** Translucent green used as the input background tint during flash */
    glow:   "rgba(62,207,106,0.18)",
    /** Border colour that replaces the default border during the flash */
    border: "#3ECF6A",
  },

  // ── Interview-specific ───────────────────────────────────────────────────
  interview: {
    badgeBg:    "#1A1E2E",
    badgeBorder:"#2A3050",
    badgeText:  "#7A90D0",
    timerText:  "#5A6A90",
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Typography
// ─────────────────────────────────────────────────────────────────────────────

export const typography = {
  /**
   * Intent label — the LLM's short summary of the current conversational moment.
   * Displayed prominently in the centre of the screen.
   * e.g. "Greeting" / "Question" / "Feedback"
   */
  intent: {
    fontSize:      32,
    fontWeight:    "300" as const,   // light weight feels ambient, not aggressive
    letterSpacing: 0.5,
    lineHeight:    40,
    color:         colors.text.intent,
  },

  /**
   * Raw transcript — secondary, low-contrast.
   * Shown below the intent label. Should not compete visually.
   */
  transcript: {
    fontSize:      14,
    fontWeight:    "400" as const,
    letterSpacing: 0.2,
    lineHeight:    20,
    color:         colors.text.transcript,
  },

  /** Screen wordmark ("prepatu") */
  wordmark: {
    fontSize:      28,
    fontWeight:    "700" as const,
    letterSpacing: 1.5,
    color:         colors.text.primary,
  },

  /** Status hint below orb — "listening" / "speaking" / "connecting…" */
  statusHint: {
    fontSize:      11,
    fontWeight:    "500" as const,
    letterSpacing: 2,
    textTransform: "uppercase" as const,
    color:         colors.text.muted,
  },

  /** Interview badge label — "Part 1" */
  interviewBadge: {
    fontSize:      12,
    fontWeight:    "600" as const,
    letterSpacing: 1,
    textTransform: "uppercase" as const,
    color:         colors.interview.badgeText,
  },

  /** Timer readout — "03:42" */
  timer: {
    fontSize:      13,
    fontWeight:    "400" as const,
    fontVariant:   ["tabular-nums"] as const,
    letterSpacing: 0.5,
    color:         colors.interview.timerText,
  },

  /** Action button label */
  actionLabel: {
    fontSize:      14,
    fontWeight:    "500" as const,
    letterSpacing: 0.3,
    color:         colors.action.label,
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Spacing
// ─────────────────────────────────────────────────────────────────────────────

export const spacing = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
  /** Distance from the side orb to the screen edge */
  orbSideMargin: 0,
  /** Vertical padding around the intent text block */
  intentBlockV:  32,
  /** Gap between intent text and transcript */
  intentToTranscript: 10,
  /** Gap between action buttons */
  actionGap: 10,
  /** Bottom controls bar height */
  controlsBarHeight: 64,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Orb sizing
// ─────────────────────────────────────────────────────────────────────────────

export const orbSizes = {
  /** Floating centre orb (interview / connected assistant) */
  centre: {
    orb:  72,
    glow: 72 + 40,
  },
  /** Corner-anchored orb (home screen / side-mode assistant) */
  corner: {
    orb:  130,
    glow: 130 + 44,
  },
  /** Side-anchored orb in assistant mode (small, right-edge) */
  side: {
    orb:  56,
    glow: 56 + 36,
  },
  /**
   * Bottom-arc — a semi-circle that protrudes upward from the screen
   * bottom edge. Flat side is flush with the screen bottom; dome faces up.
   * Takes less visual real-estate than a centred full circle.
   */
  bottomArc: {
    orb:  120,   // total diameter (width of the semi-circle)
    glow: 160,   // glow halo diameter
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Listening ring
// ─────────────────────────────────────────────────────────────────────────────

export const listeningRing = {
  /** Width of the animated SVG / border ring */
  strokeWidth:     1.5,
  /** Gap between ring outer edge and orb edge */
  gap:             6,
  /** Dash pattern for the ring (creates a subtle arc effect) */
  dashArray:       [6, 4] as [number, number],
  /** Full rotation duration (ms) */
  rotateDuration:  2800,
  /** Opacity when fully visible */
  maxOpacity:      0.7,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Animation
// ─────────────────────────────────────────────────────────────────────────────

export const animation = {
  /** How fast the orb breathes in "listening" state */
  listenBreathDuration: 1600,   // ms per half-cycle
  /** How fast the orb pulses in "speaking" state */
  speakPulseDuration:   380,

  /** Orb entrance spring (side → centre on Interview connect) */
  orbEntranceSpring: {
    tension:  60,
    friction: 10,
  },

  /** Fade-in for intent text when it changes */
  intentFadeDuration:    250,
  /** Fade-in for transcript text */
  transcriptFadeDuration: 180,

  /** Mute button tap scale-down */
  mutePressDuration: 120,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Shadows / elevation (Android + iOS)
// ─────────────────────────────────────────────────────────────────────────────

export const shadows = {
  /** Used for action button pills */
  actionPill: {
    shadowColor:   "#000",
    shadowOffset:  { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius:  4,
    elevation:     3,
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Layout helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Orb layout mode — drives position and size */
export type OrbMode = "corner" | "side" | "centre";

/**
 * Map from screen + status to the orb's layout mode.
 *
 *   Home screen              → "corner"  (pre-connection, bottom-right)
 *   Assistant (idle/connect) → "corner"
 *   Assistant (connected)    → "side"    (right edge, mid-height)
 *   Interview (any active)   → "centre"
 */
export const orbLayoutMap: Record<string, OrbMode> = {
  home_idle:             "corner",
  assistant_idle:        "corner",
  assistant_connecting:  "corner",
  assistant_connected:   "side",
  assistant_listening:   "side",
  assistant_speaking:    "side",
  interview_connecting:  "corner",   // entrance animation origin
  interview_connected:   "centre",
  interview_listening:   "centre",
  interview_speaking:    "centre",
} as const;
