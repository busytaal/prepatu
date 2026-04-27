/**
 * PracticeScreen — generic voice practice session.
 *
 * Handles any server-defined program (free_talk, ielts_practice, ielts_exam, …).
 * Auto-connects on mount, renders cue card overlay when the agent sends one.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { useVoiceSession } from "../hooks/useVoiceSession";
import type { SessionStatus } from "../hooks/useVoiceSession";
import { useGlobalVoice } from "../contexts/VoiceSessionContext";
import { VoiceOrb } from "../components/VoiceOrb";
import { colors, spacing, typography } from "../design/tokens";
import type { Artifact } from "../types/artifacts";
import type { CueCardParams } from "../types/programs";
import type { RootStackParamList } from "../../App";

type Props = NativeStackScreenProps<RootStackParamList, "Practice">;

export function PracticeScreen({ navigation, route }: Props) {
  const { programId, programName, programAccent } = route.params;
  const insets = useSafeAreaInsets();
  const accent = programAccent ?? colors.orb.connected;

  // Suspend the global ambient voice session for the duration of this screen
  const { suspendGlobal, resumeGlobal } = useGlobalVoice();
  useEffect(() => {
    suspendGlobal();
    return () => { resumeGlobal(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // ── UI state ───────────────────────────────────────────────────────────────
  const [intentText, setIntentText] = useState<string | null>(null);
  const [cueCard, setCueCard]       = useState<CueCardParams | null>(null);

  // ── Green-orb timing ───────────────────────────────────────────────────────
  const hasActivatedRef = useRef(false);
  const [orbDisplayStatus, setOrbDisplayStatus] = useState<SessionStatus>("idle");

  // Cue card slide-up animation
  const cardAnim = useRef(new Animated.Value(0)).current;

  const exitingRef = useRef(false);
  const handleArtifactRef = useRef<(artifact: Artifact) => void>(() => {});

  const { status, connect, disconnect } = useVoiceSession({
    mode:       "program",
    programId,
    onArtifact: (artifact) => handleArtifactRef.current(artifact),
  });

  // ── Derive orb display status ──────────────────────────────────────────────
  useEffect(() => {
    if (status === "speaking" && !hasActivatedRef.current) {
      hasActivatedRef.current = true;
    }
    setOrbDisplayStatus(hasActivatedRef.current ? status : "idle");
  }, [status]);

  // ── Auto-connect on mount ─────────────────────────────────────────────────
  useEffect(() => {
    connect();
    return () => {
      if (!exitingRef.current) disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Show / hide cue card ───────────────────────────────────────────────────
  const showCueCard = useCallback((card: CueCardParams) => {
    setCueCard(card);
    Animated.spring(cardAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 60,
      friction: 9,
    }).start();
  }, [cardAnim]);

  const hideCueCard = useCallback(() => {
    Animated.timing(cardAnim, {
      toValue: 0,
      duration: 250,
      useNativeDriver: true,
    }).start(() => setCueCard(null));
  }, [cardAnim]);

  // ── Artifact handler ───────────────────────────────────────────────────────
  const handleArtifact = useCallback(
    (artifact: Artifact) => {
      if (artifact.type === "intent") {
        const text = (artifact as unknown as { text?: string }).text;
        if (text) setIntentText(text);
      } else if (artifact.type === "card") {
        const params = (artifact as unknown as { params?: CueCardParams }).params;
        if (params?.cardType === "cue_card") {
          showCueCard(params);
        }
      } else if (artifact.type === "navigate") {
        const screen = (artifact as unknown as { screen?: string }).screen;
        exitingRef.current = true;
        disconnect();
        if (screen === "Home") navigation.replace("Home");
      }
    },
    [disconnect, navigation, showCueCard]
  );

  useEffect(() => {
    handleArtifactRef.current = handleArtifact;
  }, [handleArtifact]);

  const handleBack = useCallback(() => {
    exitingRef.current = true;
    disconnect();
    navigation.goBack();
  }, [disconnect, navigation]);

  const cardTranslateY = cardAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [300, 0],
  });

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: accent }]} numberOfLines={1}>
          {programName ?? "Practice"}
        </Text>
        <View style={styles.backButton} />
      </View>

      {/* ── Body ── */}
      <View style={styles.body}>
        {intentText ? (
          <Text style={styles.intentText}>{intentText}</Text>
        ) : (
          <Text style={styles.hintText}>
            {status === "connecting" ? "Connecting…" : "Speak when ready"}
          </Text>
        )}
      </View>

      {/* ── Orb footer ── */}
      <View style={[styles.orbArea, { paddingBottom: insets.bottom + spacing.md }]}>
        <VoiceOrb status={orbDisplayStatus} size={96} />
      </View>

      {/* ── Cue card overlay ── */}
      {cueCard && (
        <Animated.View
          style={[
            styles.cueCardOverlay,
            { transform: [{ translateY: cardTranslateY }] },
          ]}
        >
          <View style={styles.cueCardHandle} />
          <ScrollView contentContainerStyle={styles.cueCardContent}>
            {cueCard.instructions && (
              <Text style={styles.cueCardInstruction}>{cueCard.instructions}</Text>
            )}
            <Text style={styles.cueCardTitle}>{cueCard.title}</Text>
            {cueCard.topic && (
              <Text style={styles.cueCardTopic}>{cueCard.topic}</Text>
            )}
            {(cueCard.points ?? []).map((point, i) => (
              <Text key={i} style={styles.cueCardPoint}>
                {"  \u2022 "}{point}
              </Text>
            ))}
            {cueCard.question && (
              <Text style={styles.cueCardQuestion}>{cueCard.question}</Text>
            )}
          </ScrollView>
          <TouchableOpacity style={styles.cueCardDismiss} onPress={hideCueCard}>
            <Text style={styles.cueCardDismissText}>Dismiss</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.base,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  backIcon: {
    fontSize: 22,
    color: colors.text.primary,
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    ...typography.h3,
    fontWeight: "600",
    color: colors.text.primary,
  },
  body: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
  },
  intentText: {
    ...typography.body,
    color: colors.text.primary,
    textAlign: "center",
    lineHeight: 26,
  },
  hintText: {
    ...typography.body,
    color: colors.text.secondary,
    textAlign: "center",
  },
  orbArea: {
    alignItems: "center",
    paddingTop: spacing.lg,
  },
  // ── Cue card ──────────────────────────────────────────────────────────────
  cueCardOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.background.elevated,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "65%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 12,
  },
  cueCardHandle: {
    width: 40,
    height: 4,
    backgroundColor: colors.action.border,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  cueCardContent: {
    padding: spacing.lg,
  },
  cueCardInstruction: {
    ...typography.caption,
    color: colors.text.secondary,
    marginBottom: spacing.sm,
    fontStyle: "italic",
  },
  cueCardTitle: {
    ...typography.h3,
    color: colors.text.primary,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  cueCardTopic: {
    ...typography.body,
    color: colors.text.primary,
    fontWeight: "600",
    marginBottom: spacing.xs,
  },
  cueCardPoint: {
    ...typography.body,
    color: colors.text.secondary,
    marginBottom: 4,
  },
  cueCardQuestion: {
    ...typography.body,
    color: colors.text.primary,
    fontStyle: "italic",
    marginTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.action.border,
    paddingTop: spacing.sm,
  },
  cueCardDismiss: {
    alignItems: "center",
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.action.border,
  },
  cueCardDismissText: {
    ...typography.body,
    color: colors.text.secondary,
  },
});
