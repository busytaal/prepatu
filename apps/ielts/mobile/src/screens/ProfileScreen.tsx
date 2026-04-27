/**
 * ProfileScreen — user profile & preferences.
 *
 * Fetches GET /profile?device_id=X, lets user edit name + target band,
 * and switch active program. PATCH /profile on save.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
import type { Program } from "../types/programs";
import type { RootStackParamList } from "../../App";

type Props = NativeStackScreenProps<RootStackParamList, "Profile">;

const BAND_OPTIONS = [4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0];

export function ProfileScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();

  const [loading, setSaving]       = useState(true);
  const [saving,  setSavingState]  = useState(false);
  const [saved,   setSaved]        = useState(false);

  const [name,          setName]          = useState("");
  const [targetBand,    setTargetBand]    = useState(7.0);
  const [activeProgram, setActiveProgram] = useState("ielts_practice");
  const [programs,      setPrograms]      = useState<Program[]>([]);
  const [deviceId,      setDeviceId]      = useState("");

  const { status, voiceEnabled, dismissVoice, registerArtifactHandler } = useGlobalVoice();

  // ── Voice assistant ─────────────────────────────────────────────────────
  const handleArtifact = useCallback((artifact: Artifact) => {
    if (artifact.type === "navigate") {
      const nav = artifact as unknown as { screen?: string };
      if (nav.screen && nav.screen !== "Profile") {
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

  const loadData = useCallback(async () => {
    const did = await getDeviceId();
    setDeviceId(did);

    try {
      const [profileRes, programsRes] = await Promise.all([
        fetch(`${SERVER_URL}/profile?device_id=${encodeURIComponent(did)}`),
        fetch(`${SERVER_URL}/programs`),
      ]);
      if (profileRes.ok) {
        const p = await profileRes.json();
        setName(p.name ?? "");
        setTargetBand(p.target_band ?? 7.0);
        setActiveProgram(p.active_program ?? "ielts_practice");
      }
      if (programsRes.ok) {
        const pd = await programsRes.json();
        setPrograms(pd.programs ?? []);
      }
    } catch (e) {
      console.warn("[ProfileScreen] load failed", e);
    } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = useCallback(async () => {
    setSavingState(true);
    setSaved(false);
    try {
      const res = await fetch(`${SERVER_URL}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id:      deviceId,
          name:           name.trim() || null,
          target_band:    targetBand,
          active_program: activeProgram,
        }),
      });
      if (res.ok) setSaved(true);
    } catch (e) {
      console.warn("[ProfileScreen] save failed", e);
    } finally {
      setSavingState(false);
    }
  }, [deviceId, name, targetBand, activeProgram]);

  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.orb.connecting} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: 140 + insets.bottom }]} keyboardShouldPersistTaps="handled">
        {/* Name */}
        <Text style={styles.label}>Display Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          placeholderTextColor={colors.text.secondary}
          returnKeyType="done"
        />

        {/* Target Band */}
        <Text style={styles.label}>Target Band Score</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.bandRow}
        >
          {BAND_OPTIONS.map((b) => (
            <TouchableOpacity
              key={b}
              style={[
                styles.bandChip,
                targetBand === b && styles.bandChipActive,
              ]}
              onPress={() => setTargetBand(b)}
            >
              <Text
                style={[
                  styles.bandChipText,
                  targetBand === b && styles.bandChipTextActive,
                ]}
              >
                {b.toFixed(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Active program */}
        {programs.length > 0 && (
          <>
            <Text style={styles.label}>Default Practice Mode</Text>
            {programs.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={[
                  styles.programRow,
                  activeProgram === p.id && {
                    borderColor: p.accent,
                    borderWidth: 2,
                  },
                ]}
                onPress={() => setActiveProgram(p.id)}
              >
                <View style={[styles.programDot, { backgroundColor: p.accent }]} />
                <View style={styles.programInfo}>
                  <Text style={styles.programName}>{p.name}</Text>
                  <Text style={styles.programSub}>{p.subtitle}</Text>
                </View>
                {activeProgram === p.id && (
                  <Text style={[styles.checkmark, { color: p.accent }]}>✓</Text>
                )}
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* Save */}
        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={styles.saveButtonText}>
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
          </Text>
        </TouchableOpacity>
      </ScrollView>

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
  container:   { flex: 1, backgroundColor: colors.background.base },
  centered:    { justifyContent: "center", alignItems: "center" },
  header:      { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  backButton:  { width: 44, height: 44, justifyContent: "center", alignItems: "center" },
  backIcon:    { fontSize: 22, color: colors.text.primary },
  headerTitle: { flex: 1, textAlign: "center", ...typography.h3, fontWeight: "600", color: colors.text.primary },
  scroll:      { padding: spacing.lg, paddingBottom: 60 },
  label:       { ...typography.caption, color: colors.text.secondary, fontWeight: "600", marginBottom: spacing.xs, marginTop: spacing.lg, textTransform: "uppercase", letterSpacing: 0.8 },
  input:       {
    backgroundColor: colors.background.surface,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    ...typography.body,
    color: colors.text.primary,
    borderWidth: 1,
    borderColor: colors.action.border,
  },
  bandRow:     { flexDirection: "row", gap: spacing.xs, paddingVertical: spacing.xs },
  bandChip:    {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.background.surface,
    borderWidth: 1,
    borderColor: colors.action.border,
  },
  bandChipActive:     { backgroundColor: colors.orb.connected, borderColor: colors.orb.connected },
  bandChipText:       { ...typography.body, color: colors.text.secondary },
  bandChipTextActive: { color: "#fff", fontWeight: "700" },
  programRow:  {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.background.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.action.border,
  },
  programDot:  { width: 12, height: 12, borderRadius: 6, marginRight: spacing.sm },
  programInfo: { flex: 1 },
  programName: { ...typography.body, fontWeight: "600", color: colors.text.primary },
  programSub:  { ...typography.caption, color: colors.text.secondary, marginTop: 2 },
  checkmark:   { fontSize: 18, fontWeight: "700" },
  saveButton:  {
    marginTop: spacing.xl,
    backgroundColor: colors.orb.connected,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText:     { ...typography.body, color: "#fff", fontWeight: "700", fontSize: 16 },
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
  noVoiceBtn:   { paddingBottom: spacing.sm },
  noVoiceLabel: { fontSize: 12, color: colors.text.muted, letterSpacing: 0.3 },
  voiceOffBadge:{ height: 44, justifyContent: "center", alignItems: "center" },
  voiceOffLabel:{ fontSize: 11, color: colors.text.muted, letterSpacing: 1.5, textTransform: "uppercase" as const },
});
