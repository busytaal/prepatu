/**
 * HistoryScreen — session history dashboard.
 *
 * Fetches GET /sessions?device_id=X, shows scored sessions sorted newest-first.
 * Tapping a row expands the IELTS band breakdown and examiner feedback.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { colors, spacing, typography } from "../design/tokens";
import { getDeviceId } from "../utils/deviceId";
import { SERVER_URL } from "../config";
import { useFocusEffect } from "@react-navigation/native";
import { useGlobalVoice } from "../contexts/VoiceSessionContext";
import { VoiceOrb } from "../components/VoiceOrb";
import type { Artifact } from "../types/artifacts";
import type { RootStackParamList } from "../../App";

type Props = NativeStackScreenProps<RootStackParamList, "History">;

type SessionRow = {
  id: string;
  program_id: string | null;
  started_at: number;
  duration_secs: number;
  overall_band: number | null;
  fluency_coherence: number | null;
  lexical_resource: number | null;
  grammatical_range: number | null;
  pronunciation: number | null;
  topics: string[];
  feedback: {
    strengths?: string[];
    improvements?: string[];
    examiner_comment?: string;
  };
};

const PROGRAM_LABELS: Record<string, { label: string; accent: string }> = {
  free_talk:      { label: "Free Talk",       accent: "#4A90E2" },
  ielts_practice: { label: "IELTS Practice",  accent: "#3ECF6A" },
  ielts_exam:     { label: "IELTS Exam",      accent: "#E8A020" },
};

function bandColor(band: number | null): string {
  if (band === null) return colors.text.secondary;
  if (band >= 7.5) return "#3ECF6A";
  if (band >= 6.0) return "#F5C518";
  return "#E8573F";
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function HistoryScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { status, voiceEnabled, dismissVoice, registerArtifactHandler } = useGlobalVoice();

  // ── Voice assistant ─────────────────────────────────────────────────────
  const handleArtifact = useCallback((artifact: Artifact) => {
    if (artifact.type === "navigate") {
      const nav = artifact as unknown as { screen?: string };
      if (nav.screen && nav.screen !== "History") {
        navigation.navigate(nav.screen as any);
      }
    }
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      registerArtifactHandler(handleArtifact);
      return () => registerArtifactHandler(null);
    }, [handleArtifact, registerArtifactHandler]),
  );

  const loadSessions = useCallback(async () => {
    const deviceId = await getDeviceId();
    try {
      const res = await fetch(`${SERVER_URL}/sessions?device_id=${encodeURIComponent(deviceId)}`);
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions ?? data ?? []);
      }
    } catch (e) {
      console.warn("[HistoryScreen] fetch failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => (prev === id ? null : id));
  };

  const renderItem = ({ item }: { item: SessionRow }) => {
    const programInfo = PROGRAM_LABELS[item.program_id ?? ""] ?? { label: item.program_id ?? "Session", accent: colors.text.secondary };
    const isExpanded = expanded === item.id;

    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => toggleExpand(item.id)}
        activeOpacity={0.75}
      >
        {/* Row header */}
        <View style={styles.rowHeader}>
          <View style={[styles.accentDot, { backgroundColor: programInfo.accent }]} />
          <View style={styles.rowMeta}>
            <Text style={styles.rowLabel}>{programInfo.label}</Text>
            <Text style={styles.rowDate}>{formatDate(item.started_at)} · {formatDuration(item.duration_secs)}</Text>
          </View>
          {item.overall_band !== null && (
            <Text style={[styles.bandBadge, { color: bandColor(item.overall_band) }]}>
              {item.overall_band.toFixed(1)}
            </Text>
          )}
          <Text style={styles.chevron}>{isExpanded ? "▲" : "▼"}</Text>
        </View>

        {/* Expanded detail */}
        {isExpanded && (
          <View style={styles.detail}>
            {item.overall_band !== null && (
              <View style={styles.criteriaGrid}>
                {[
                  { label: "FC",  value: item.fluency_coherence },
                  { label: "LR",  value: item.lexical_resource },
                  { label: "GRA", value: item.grammatical_range },
                  { label: "P",   value: item.pronunciation },
                ].map(({ label, value }) => (
                  <View key={label} style={styles.criteriaCell}>
                    <Text style={[styles.criteriaScore, { color: bandColor(value) }]}>
                      {value?.toFixed(1) ?? "–"}
                    </Text>
                    <Text style={styles.criteriaLabel}>{label}</Text>
                  </View>
                ))}
              </View>
            )}
            {item.feedback?.examiner_comment ? (
              <Text style={styles.examinerComment}>{item.feedback.examiner_comment}</Text>
            ) : null}
            {(item.feedback?.improvements ?? []).length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Areas to improve</Text>
                {(item.feedback.improvements ?? []).map((imp, i) => (
                  <Text key={i} style={styles.bullet}>{"\u2022 "}{imp}</Text>
                ))}
              </View>
            )}
            {(item.topics ?? []).length > 0 && (
              <View style={styles.topicRow}>
                {item.topics.map((t, i) => (
                  <View key={i} style={styles.topicChip}>
                    <Text style={styles.topicChipText}>{t}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>History</Text>
        <View style={styles.backButton} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.orb.connecting} />
        </View>
      ) : sessions.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No sessions yet — start practising!</Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: 130 + insets.bottom }]}
        />
      )}

      {/* ── Bottom-arc voice orb ───────────────────────────────────────────────── */}
      <View style={[styles.orbFooter, { paddingBottom: Math.max(insets.bottom, 0) }]}>
        {voiceEnabled ? (
          <>
            <VoiceOrb status={status} mode={insets.bottom === 0 ? "bottom-arc" : "side"} onPress={dismissVoice} />
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
  container:    { flex: 1, backgroundColor: colors.background.base },
  header:       { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  backButton:   { width: 44, height: 44, justifyContent: "center", alignItems: "center" },
  backIcon:     { fontSize: 22, color: colors.text.primary },
  headerTitle:  { flex: 1, textAlign: "center", ...typography.h3, fontWeight: "600", color: colors.text.primary },
  centered:     { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyText:    { ...typography.body, color: colors.text.secondary, textAlign: "center" },
  list:         { padding: spacing.md, gap: spacing.sm },
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
  noVoiceBtn:  { paddingBottom: spacing.sm },
  noVoiceLabel:{ fontSize: 12, color: colors.text.muted, letterSpacing: 0.3 },
  voiceOffBadge: { height: 44, justifyContent: "center", alignItems: "center" },
  voiceOffLabel: { fontSize: 11, color: colors.text.muted, letterSpacing: 1.5, textTransform: "uppercase" as const },
  row:          {
    backgroundColor: colors.background.surface,
    borderRadius: 12,
    padding: spacing.md,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  rowHeader:    { flexDirection: "row", alignItems: "center" },
  accentDot:    { width: 10, height: 10, borderRadius: 5, marginRight: spacing.sm },
  rowMeta:      { flex: 1 },
  rowLabel:     { ...typography.body, fontWeight: "600", color: colors.text.primary },
  rowDate:      { ...typography.caption, color: colors.text.secondary, marginTop: 2 },
  bandBadge:    { fontSize: 20, fontWeight: "700", marginRight: spacing.sm },
  chevron:      { fontSize: 12, color: colors.text.secondary },
  detail:       { marginTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.action.border, paddingTop: spacing.md },
  criteriaGrid: { flexDirection: "row", justifyContent: "space-around", marginBottom: spacing.md },
  criteriaCell: { alignItems: "center" },
  criteriaScore:{ fontSize: 22, fontWeight: "700" },
  criteriaLabel:{ ...typography.caption, color: colors.text.secondary, marginTop: 2 },
  examinerComment: { ...typography.body, color: colors.text.primary, lineHeight: 22, marginBottom: spacing.sm },
  section:      { marginTop: spacing.sm },
  sectionTitle: { ...typography.caption, color: colors.text.secondary, fontWeight: "600", marginBottom: 4 },
  bullet:       { ...typography.body, color: colors.text.primary, marginBottom: 4 },
  topicRow:     { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: spacing.sm },
  topicChip:    { backgroundColor: colors.action.border, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  topicChipText:{ ...typography.caption, color: colors.text.secondary },
});
