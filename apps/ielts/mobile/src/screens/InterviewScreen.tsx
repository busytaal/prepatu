/**
 * InterviewScreen — IELTS practice voice interface.
 *
 * Orb is CENTRED — it owns the visual focal point.
 * This signals "you answer to me" — the examiner speaks, you respond.
 *
 * Layout:
 *   ┌──────────────────────────────┐
 *   │  [ Part 1 ]          03:42   │  ← badge left, timer right
 *   │                              │
 *   │        Intent text           │  ← 32pt light, centred
 *   │        transcript line       │  ← 14pt muted, centred
 *   │                              │
 *   │           [ orb ]            │  ← centred, entrance spring from bottom
 *   │                              │
 *   │   [ Yes ]  [ No ]  [ Skip ]  │  ← action pills
 *   │  [🎙️]  [🔊]                 │  ← mute controls
 *   └──────────────────────────────┘
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { useVoiceSession } from "../hooks/useVoiceSession";
import { useGlobalVoice } from "../contexts/VoiceSessionContext";
import { useSessionTracking } from "../hooks/useSessionTracking";
import { useContextTracking } from "../hooks/useContextTracking";
import { VoiceOrb } from "../components/VoiceOrb";
import { ArtifactArea } from "../components/ArtifactArea";
import { ActionPills } from "../components/ActionPills";
import { MuteControls } from "../components/MuteControls";
import { colors, spacing, typography, animation } from "../design/tokens";
import type { Artifact, OptionsArtifact } from "../types/artifacts";
import type { RootStackParamList } from "../../App";

type Props = NativeStackScreenProps<RootStackParamList, "Interview">;

const TYPE_LABEL: Record<string, string> = {
  part1: "Part 1",
  part2: "Part 2",
  part3: "Part 3",
  full:  "Full Mock",
  idle:  "Practice",
};

function useTimer(running: boolean) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function InterviewScreen({ route, navigation }: Props) {
  const interviewType = route.params?.interviewType ?? "part1";
  const insets = useSafeAreaInsets();

  // Suspend the global ambient voice session for the duration of this screen
  const { suspendGlobal, resumeGlobal } = useGlobalVoice();
  useEffect(() => {
    suspendGlobal();
    return () => { resumeGlobal(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Orb entrance — starts off-screen bottom, springs to 0 once connected
  const translateY = useRef(new Animated.Value(300)).current;

  // ── Artifact state ─────────────────────────────────────────────────────────
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null);
  const [artifactBadge,  setArtifactBadge]  = useState(0);
  const [activeOptions,  setActiveOptions]  = useState<OptionsArtifact | null>(null);

  const handleArtifact = useCallback(
    (artifact: Artifact) => {
      if (artifact.type === "dismiss") {
        const target = (artifact as { targetId?: string }).targetId;
        if (!target || activeArtifact?.id === target) {
          setActiveArtifact(null);
          setActiveOptions(null);
        }
        return;
      }
      if (artifact.type === "navigate") {
        navigation.navigate(
          artifact.screen as keyof RootStackParamList,
          (artifact.params ?? {}) as never,
        );
        return;
      }
      if (artifact.type === "options") {
        setActiveOptions(artifact as OptionsArtifact);
        return;
      }
      setActiveArtifact(artifact);
      setArtifactBadge((n) => n + 1);
    },
    [activeArtifact, navigation],
  );

  const handleArtifactAction = useCallback(
    (artifactId: string, action: string) => {
      if (action === "select" || action === "dismiss") {
        setActiveArtifact(null);
        setActiveOptions(null);
      }
    },
    [],
  );

  // ── Voice session ──────────────────────────────────────────────────────────
  const {
    status,
    transcript,
    intent,
    micMuted,
    spkMuted,
    toggleMicMute,
    toggleSpkMute,
    connect,
    disconnect,
  } = useVoiceSession({ mode: "interview", interviewType, onArtifact: handleArtifact });

  useSessionTracking({ mode: "interview", status });
  useContextTracking("Interview", { interview_type: interviewType });

  useEffect(() => {
    connect();
    return () => { disconnect(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Entrance spring
  useEffect(() => {
    if (status === "connected" || status === "listening" || status === "speaking") {
      Animated.spring(translateY, {
        toValue:         0,
        useNativeDriver: true,
        tension:         animation.orbEntranceSpring.tension,
        friction:        animation.orbEntranceSpring.friction,
      }).start();
    }
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (status === "ended" || status === "error") {
      const t = setTimeout(() => navigation.goBack(), 800);
      return () => clearTimeout(t);
    }
  }, [status, navigation]);

  const timerActive = status === "listening" || status === "speaking" || status === "connected";
  const timer = useTimer(timerActive);

  return (
    <View
      style={[
        styles.screen,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{TYPE_LABEL[interviewType] ?? interviewType}</Text>
        </View>
        {timerActive && <Text style={styles.timer}>{timer}</Text>}
      </View>

      {/* ── Intent text + transcript (centred) ── */}
      <ArtifactArea
        intent={intent}
        transcript={transcript}
        artifact={activeArtifact}
        align="centre"
        onArtifactAction={handleArtifactAction}
      />

      {/* ── Centre orb (entrance animated from bottom) ── */}
      <Animated.View style={[styles.orbRow, { transform: [{ translateY }] }]}>
        <VoiceOrb status={status} mode="centre" artifactBadge={artifactBadge} />
      </Animated.View>

      {/* ── Status hint below orb ── */}
      <Text style={styles.statusHint}>
        {status === "listening" ? "LISTENING"
          : status === "speaking" ? "SPEAKING"
          : status === "connecting" ? "CONNECTING…"
          : ""}
      </Text>

      {/* ── Action pills ── */}
      <ActionPills
        artifact={activeOptions}
        onAction={(artifactId, optionId) => {
          handleArtifactAction(artifactId, "select");
        }}
      />

      {/* ── Mute controls ── */}
      <View style={styles.muteBar}>
        <MuteControls
          micMuted={micMuted}
          spkMuted={spkMuted}
          onToggleMic={toggleMicMute}
          onToggleSpk={toggleSpkMute}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex:            1,
    backgroundColor: colors.background.base,
  },
  header: {
    flexDirection:     "row",
    alignItems:        "center",
    paddingHorizontal: spacing.lg,
    paddingVertical:   spacing.sm + 4,
    gap:               spacing.md,
  },
  badge: {
    backgroundColor: colors.interview.badgeBg,
    borderWidth:     1,
    borderColor:     colors.interview.badgeBorder,
    borderRadius:    20,
    paddingHorizontal: 12,
    paddingVertical:    5,
  },
  badgeText: {
    fontSize:      typography.interviewBadge.fontSize,
    fontWeight:    typography.interviewBadge.fontWeight,
    letterSpacing: typography.interviewBadge.letterSpacing,
    color:         colors.interview.badgeText,
  },
  timer: {
    marginLeft:    "auto",
    fontSize:      typography.timer.fontSize,
    fontWeight:    typography.timer.fontWeight,
    letterSpacing: typography.timer.letterSpacing,
    color:         colors.interview.timerText,
  },
  orbRow: {
    alignItems:      "center",
    justifyContent:  "center",
    paddingVertical: spacing.xl,
  },
  statusHint: {
    textAlign:     "center",
    fontSize:      typography.statusHint.fontSize,
    letterSpacing: typography.statusHint.letterSpacing,
    color:         colors.text.muted,
    marginBottom:  spacing.sm,
  },
  muteBar: {
    flexDirection: "row",   // MuteControls uses flex:1 internally; wrap it
  },
});
