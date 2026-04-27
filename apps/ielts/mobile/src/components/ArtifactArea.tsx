/**
 * ArtifactArea — primary content region for voice screens.
 *
 * Layout:
 *   1. Intent text  — large, prominent. Short LLM label (e.g. "Question").
 *   2. Transcript   — last user or assistant line, muted secondary text.
 *   3. Card overlay — feedback / info cards animate over the intent block.
 *      Options artifacts are NOT rendered here; screens handle them as ActionPills.
 *
 * Pass `align="centre"` (interview) or `align="left"` (assistant).
 */

import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { colors, typography, spacing } from "../design/tokens";
import type { Artifact, ArtifactRendererRegistry, TranscriptEntry } from "../types/artifacts";

interface Props {
  /** LLM-generated short label for the current conversational moment. */
  intent: string | null;
  /** All transcript entries — only the most recent line is shown. */
  transcript: TranscriptEntry[];
  /**
   * Active non-options artifact from the LLM, or null.
   * Options artifacts must be handled by the parent screen as ActionPills.
   */
  artifact: Artifact | null;
  /** Text alignment — "centre" for interview, "left" for assistant. */
  align?: "centre" | "left";
  renderers?: ArtifactRendererRegistry;
  onArtifactAction?: (artifactId: string, action: string, value?: unknown) => void;
}

// ─── Card renderers (feedback + info) ─────────────────────────────────────────

function CardOverlay({
  artifact,
  onAction,
}: {
  artifact: Artifact;
  onAction: (a: string, v?: unknown) => void;
}) {
  if (artifact.type === "feedback") {
    const { content } = artifact;
    return (
      <View style={cardStyles.feedbackCard}>
        <Text style={cardStyles.feedbackType}>{artifact.feedbackType.toUpperCase()}</Text>
        <Text style={cardStyles.feedbackContent}>
          {typeof content.text === "string" ? content.text : JSON.stringify(content)}
        </Text>
      </View>
    );
  }

  if (artifact.type === "card") {
    const isKV =
      artifact.cardType === "info" &&
      typeof artifact.content === "object" &&
      !("text" in artifact.content);
    return (
      <View style={cardStyles.infoCard}>
        {artifact.title ? <Text style={cardStyles.cardTitle}>{artifact.title}</Text> : null}
        {isKV ? (
          <View style={{ gap: 5 }}>
            {Object.entries(artifact.content).map(([k, v]) => (
              <View key={k} style={cardStyles.kvRow}>
                <Text style={cardStyles.kvKey}>{k.replace(/_/g, " ")}</Text>
                <Text style={cardStyles.kvVal}>{String(v)}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={cardStyles.cardContent}>
            {typeof (artifact.content as Record<string, unknown>).text === "string"
              ? String((artifact.content as Record<string, unknown>).text)
              : JSON.stringify(artifact.content)}
          </Text>
        )}
      </View>
    );
  }

  void onAction; // suppress unused warning for navigate/dismiss/options which aren't rendered here
  return null;
}

const cardStyles = StyleSheet.create({
  feedbackCard: {
    marginHorizontal: spacing.md,
    padding: spacing.md,
    backgroundColor: "#1A2520",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2A4035",
  },
  feedbackType: {
    color: colors.orb.listening,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 6,
  },
  feedbackContent: {
    color: colors.text.secondary,
    fontSize: 14,
    lineHeight: 20,
  },
  infoCard: {
    marginHorizontal: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.background.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2A2A48",
  },
  cardTitle: {
    color: "#A0A8FF",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  cardContent: { color: colors.text.secondary, fontSize: 14, lineHeight: 20 },
  kvRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  kvKey: { color: "#7878AA", fontSize: 12, textTransform: "capitalize", flex: 1 },
  kvVal: { color: "#DDDDEE", fontSize: 12, fontWeight: "600", textAlign: "right" },
});

// ─── ArtifactArea ──────────────────────────────────────────────────────────────

export function ArtifactArea({
  intent,
  transcript,
  artifact,
  align = "centre",
  renderers,
  onArtifactAction,
}: Props) {
  const intentOpac   = useRef(new Animated.Value(intent ? 1 : 0)).current;
  const intentVal    = useRef(intent);
  const cardOpac     = useRef(new Animated.Value(0)).current;
  const cardSlideY   = useRef(new Animated.Value(16)).current;
  const prevCardId   = useRef<string | null>(null);

  // ── Intent fade on change ──────────────────────────────────────────────────
  useEffect(() => {
    if (intent === intentVal.current) return;
    intentVal.current = intent;
    Animated.sequence([
      Animated.timing(intentOpac, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(intentOpac, { toValue: 1, duration: typography.intent.fontSize * 6, useNativeDriver: true }),
    ]).start();
  }, [intent]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Card overlay animation ─────────────────────────────────────────────────
  const showCard =
    artifact &&
    artifact.type !== "navigate" &&
    artifact.type !== "dismiss" &&
    artifact.type !== "options";

  useEffect(() => {
    if (showCard && prevCardId.current !== artifact!.id) {
      prevCardId.current = artifact!.id;
      Animated.parallel([
        Animated.timing(cardSlideY, { toValue: 16, duration: 0, useNativeDriver: true }),
        Animated.timing(cardOpac,   { toValue: 0,  duration: 0, useNativeDriver: true }),
      ]).start(() => {
        Animated.parallel([
          Animated.timing(cardOpac,   { toValue: 1, duration: 280, useNativeDriver: true }),
          Animated.timing(cardSlideY, { toValue: 0, duration: 280, useNativeDriver: true }),
        ]).start();
      });
    } else if (!showCard) {
      prevCardId.current = null;
      Animated.timing(cardOpac, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    }
  }, [artifact?.id, showCard]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCardAction = (action: string, value?: unknown) => {
    if (artifact) onArtifactAction?.(artifact.id, action, value);
  };

  const textAlign = align === "centre" ? "center" : "left";
  const lastEntry = transcript[transcript.length - 1] ?? null;

  const renderCard = () => {
    if (!artifact || !showCard) return null;
    const custom = renderers?.[artifact.type as keyof typeof renderers] as
      | ((a: typeof artifact, cb: (action: string, v?: unknown) => void) => React.ReactElement | null)
      | undefined;
    if (custom) return custom(artifact as never, handleCardAction);
    return <CardOverlay artifact={artifact} onAction={handleCardAction} />;
  };

  return (
    <View style={styles.root}>
      {/* ── Intent text ── */}
      <Animated.Text
        numberOfLines={2}
        style={[
          styles.intent,
          { textAlign, opacity: intentOpac },
        ]}
      >
        {intent ?? ""}
      </Animated.Text>

      {/* ── Last transcript line ── */}
      {lastEntry && (
        <Text
          numberOfLines={2}
          style={[styles.transcript, { textAlign }]}
        >
          {lastEntry.text}
        </Text>
      )}

      {/* ── Card overlay ── */}
      {showCard && (
        <Animated.View
          style={[
            styles.cardOverlay,
            {
              opacity: cardOpac,
              transform: [{ translateY: cardSlideY }],
            },
          ]}
        >
          {renderCard()}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.intentBlockV,
    gap: spacing.intentToTranscript,
  },
  intent: {
    fontSize:      typography.intent.fontSize,
    fontWeight:    typography.intent.fontWeight,
    letterSpacing: typography.intent.letterSpacing,
    lineHeight:    typography.intent.lineHeight,
    color:         colors.text.intent,
  },
  transcript: {
    fontSize:      typography.transcript.fontSize,
    fontWeight:    typography.transcript.fontWeight,
    letterSpacing: typography.transcript.letterSpacing,
    lineHeight:    typography.transcript.lineHeight,
    color:         colors.text.transcript,
  },
  cardOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: spacing.md,
  },
});
