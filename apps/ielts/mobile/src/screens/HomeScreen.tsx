import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../App";
import { useGlobalVoice } from "../contexts/VoiceSessionContext";
import { VoiceOrb } from "../components/VoiceOrb";
import { colors, spacing, typography } from "../design/tokens";
import type { Artifact } from "../types/artifacts";
import type { Program } from "../types/programs";
import { SERVER_URL } from "../config";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

export function HomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loadingPrograms, setLoadingPrograms] = useState(true);

  const { status, intent, voiceEnabled, dismissVoice, registerArtifactHandler } = useGlobalVoice();

  // Fetch programs from server
  useEffect(() => {
    fetch(`${SERVER_URL}/programs`)
      .then((r) => r.json())
      .then((data) => setPrograms(data.programs ?? []))
      .catch((e) => console.warn("[HomeScreen] failed to fetch programs", e))
      .finally(() => setLoadingPrograms(false));
  }, []);

  const handleArtifact = useCallback(
    (artifact: Artifact) => {
      if (artifact.type === "navigate") {
        const nav = artifact as unknown as { screen?: string };
        if (nav.screen && nav.screen !== "Home") {
          navigation.navigate(nav.screen as any);
        }
      }
    },
    [navigation],
  );

  useFocusEffect(
    useCallback(() => {
      registerArtifactHandler(handleArtifact);
      return () => registerArtifactHandler(null);
    }, [handleArtifact, registerArtifactHandler]),
  );

  const goToProgram = useCallback(
    (program: Program) => {
      navigation.navigate("Practice", {
        programId:      program.id,
        programName:    program.name,
        programAccent:  program.accent,
      });
    },
    [navigation],
  );

  const statusLabel =
    status === "connecting" ? "CONNECTING" :
    status === "listening"  ? "LISTENING"  :
    status === "speaking"   ? "SPEAKING"   : "";

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.wordmark}>prepatu</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => navigation.navigate("History")} style={styles.iconButton}>
            <Text style={styles.iconButtonText}>📊</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate("Profile")} style={styles.iconButton}>
            <Text style={styles.iconButtonText}>👤</Text>
          </TouchableOpacity>
        </View>
      </View>

      {!!intent && (
        <Text style={styles.intentHint} numberOfLines={2}>{intent}</Text>
      )}

      {/* ── Program cards ───────────────────────────────────────────────── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 180 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {loadingPrograms ? (
          <ActivityIndicator color={colors.orb.connecting} style={{ marginTop: spacing.xl }} />
        ) : programs.length === 0 ? (
          <Text style={styles.emptyText}>No programs available</Text>
        ) : (
          programs.map((program) => (
            <TouchableOpacity
              key={program.id}
              style={[styles.programCard, { borderTopColor: program.accent }]}
              onPress={() => goToProgram(program)}
              activeOpacity={0.8}
            >
              <Text style={[styles.programTag, { color: program.accent }]}>
                {program.language.toUpperCase()}
              </Text>
              <Text style={styles.programTitle}>{program.name}</Text>
              <Text style={styles.programSubtitle}>{program.subtitle}</Text>
              {program.description ? (
                <Text style={styles.programDesc}>{program.description}</Text>
              ) : null}
            </TouchableOpacity>
          ))
        )}

        <Text style={styles.voiceHint}>
          {status === "listening"
            ? `Listening\u2009\u2014\u2009say the mode name to begin`
            : `Tap a card or speak to start`}
        </Text>
      </ScrollView>

      {/* ── Bottom-arc orb footer ───────────────────────────────────────────────────── */}
      <View style={[styles.orbFooter, { paddingBottom: Math.max(insets.bottom, 0) }]}>
        {voiceEnabled ? (
          <>
            <VoiceOrb status={status} mode={insets.bottom === 0 ? "bottom-arc" : "side"} onPress={dismissVoice} />
            {!!statusLabel && <Text style={styles.statusLabel}>{statusLabel}</Text>}
            <TouchableOpacity
              onPress={dismissVoice}
              hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
              style={styles.noVoiceBtn}
            >
              <Text style={styles.noVoiceLabel}>no voice assistance</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.voiceOffBadge}>
            <Text style={styles.voiceOffLabel}>voice off</Text>
          </View>
        )}
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
    justifyContent:    "space-between",
    alignItems:        "center",
    paddingHorizontal: spacing.lg,
    paddingTop:        spacing.lg,
    paddingBottom:     spacing.md,
  },
  wordmark: {
    fontSize:      typography.wordmark.fontSize,
    fontWeight:    typography.wordmark.fontWeight,
    letterSpacing: typography.wordmark.letterSpacing,
    color:         colors.text.primary,
  },
  headerActions: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  iconButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  iconButtonText: {
    fontSize: 20,
  },
  intentHint: {
    marginHorizontal: spacing.lg,
    marginBottom:     spacing.sm,
    fontSize:         13,
    color:            colors.text.muted,
    textAlign:        "center",
    letterSpacing:    0.2,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop:        spacing.sm,
    gap:               spacing.sm,
    paddingBottom:     140,
  },
  programCard: {
    backgroundColor: colors.background.surface,
    borderRadius:    16,
    padding:         spacing.lg,
    borderTopWidth:  2,
    gap:             spacing.xs,
  },
  programTag: {
    fontSize:      10,
    fontWeight:    "700" as const,
    letterSpacing: 1.5,
  },
  programTitle: {
    fontSize:   22,
    fontWeight: "600" as const,
    color:      colors.text.primary,
  },
  programSubtitle: {
    fontSize:   14,
    fontWeight: "400" as const,
    color:      colors.text.secondary,
  },
  programDesc: {
    fontSize:   13,
    fontWeight: "300" as const,
    color:      colors.text.secondary,
    marginTop:  spacing.xs,
  },
  emptyText: {
    textAlign:  "center",
    color:      colors.text.muted,
    marginTop:  spacing.xl,
    fontSize:   14,
  },
  voiceHint: {
    fontSize:      13,
    color:         colors.text.muted,
    textAlign:     "center",
    fontStyle:     "italic",
    marginTop:     spacing.lg,
    letterSpacing: 0.2,
  },
  orbFooter: {
    position:        "absolute",
    bottom:          0,
    left:            0,
    right:           0,
    alignItems:      "center",
    paddingTop:      spacing.xs,
    gap:             4,
    backgroundColor: "transparent",
  },
  noVoiceBtn: {
    paddingBottom: spacing.sm,
  },
  noVoiceLabel: {
    fontSize:      12,
    color:         colors.text.muted,
    letterSpacing: 0.3,
  },
  voiceOffBadge: {
    height:         44,
    justifyContent: "center",
    alignItems:     "center",
  },
  voiceOffLabel: {
    fontSize:      11,
    color:         colors.text.muted,
    letterSpacing: 1.5,
    textTransform: "uppercase" as const,
  },
  statusLabel: {
    fontSize:      10,
    fontWeight:    "600" as const,
    letterSpacing: 2.5,
    color:         colors.text.muted,
    textTransform: "uppercase" as const,
  },
});

