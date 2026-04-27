/**
 * AssistantScreen — voice navigation assistant.
 *
 * The corner orb (bottom-right quarter-circle) stays in its home-screen
 * position but changes COLOR to communicate agent state:
 *   idle/connecting  → amber breathe
 *   listening        → green + rotating ring
 *   speaking         → blue pulse
 *
 * This signals "I am at your service" — the agent waits in the corner,
 * ready to act when you speak.
 *
 * Layout:
 *   ┌──────────────────────────────┐
 *   │  prepatu                     │  ← wordmark top-left
 *   │                              │
 *   │  Intent text                 │  ← 32pt light, left-aligned
 *   │  transcript line             │  ← 14pt muted
 *   │                              │
 *   │  [ Action ] [ Action ]       │  ← action pills (options artifact)
 *   │                              │
 *   │  [🎙️]  [🔊]          [orb]  │  ← mute left, corner orb bottom-right
 *   └──────────────────────────────┘
 */
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { useVoiceSession } from "../hooks/useVoiceSession";
import { useSessionTracking } from "../hooks/useSessionTracking";
import { useContextTracking } from "../hooks/useContextTracking";
import { VoiceOrb } from "../components/VoiceOrb";
import { ArtifactArea } from "../components/ArtifactArea";
import { ActionPills } from "../components/ActionPills";
import { MuteControls } from "../components/MuteControls";
import { colors, spacing, typography } from "../design/tokens";
import type { Artifact, OptionsArtifact } from "../types/artifacts";
import type { RootStackParamList } from "../../App";

type Props = NativeStackScreenProps<RootStackParamList, "Assistant">;

export function AssistantScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();

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
  } = useVoiceSession({ mode: "assistant", onArtifact: handleArtifact });

  useSessionTracking({ mode: "assistant", status });
  useContextTracking("Assistant");

  useEffect(() => {
    connect();
    return () => { disconnect(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (status === "ended" || status === "error") {
      const t = setTimeout(() => navigation.goBack(), 800);
      return () => clearTimeout(t);
    }
  }, [status, navigation]);

  return (
    <View
      style={[
        styles.screen,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      {/* ── Wordmark ── */}
      <View style={styles.wordmarkBlock}>
        <Text style={styles.wordmark}>prepatu</Text>
      </View>

      {/* ── Intent + transcript ── */}
      <ArtifactArea
        intent={intent}
        transcript={transcript}
        artifact={activeArtifact}
        align="left"
        onArtifactAction={handleArtifactAction}
      />

      {/* ── Action pills ── */}
      <ActionPills
        artifact={activeOptions}
        onAction={(artifactId) => handleArtifactAction(artifactId, "select")}
      />

      {/* ── Bottom bar: mute controls left, corner orb right ── */}
      <View style={styles.bottomBar}>
        <MuteControls
          micMuted={micMuted}
          spkMuted={spkMuted}
          onToggleMic={toggleMicMute}
          onToggleSpk={toggleSpkMute}
        />
        {/* Corner orb — same position as home screen, just reflects agent state */}
        <View style={styles.orbCorner}>
          <VoiceOrb
            status={status}
            mode="corner"
            artifactBadge={artifactBadge}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex:            1,
    backgroundColor: colors.background.base,
  },
  wordmarkBlock: {
    paddingHorizontal: spacing.lg,
    paddingTop:        spacing.md,
    paddingBottom:     spacing.sm,
  },
  wordmark: {
    fontSize:      typography.wordmark.fontSize,
    fontWeight:    typography.wordmark.fontWeight,
    letterSpacing: typography.wordmark.letterSpacing,
    color:         colors.text.primary,
  },
  bottomBar: {
    flexDirection: "row",
    alignItems:    "flex-end",
  },
  orbCorner: {
    marginLeft: "auto",
  },
});
