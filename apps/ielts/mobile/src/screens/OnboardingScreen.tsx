/**
 * OnboardingScreen — first-run experience.
 *
 * Flow:
 *   1. Connect (mode=onboarding) — agent delivers a warm welcome via TTS.
 *      The orb activates GREEN simultaneously with the first spoken word.
 *   2. Agent transitions to collect_info — form slides up with spring animation.
 *   3. User provides name + DOB (voice or typing).
 *   4. Agent confirms, then the orb glides to center-bottom.
 *   5. navigate artifact → Home.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { useVoiceSession } from "../hooks/useVoiceSession";
import type { SessionStatus } from "../hooks/useVoiceSession";
import { VoiceOrb } from "../components/VoiceOrb";
import { colors, spacing, typography } from "../design/tokens";
import type { Artifact, FormArtifact, FieldUpdateArtifact } from "../types/artifacts";
import type { RootStackParamList } from "../../App";

type Props = NativeStackScreenProps<RootStackParamList, "Onboarding">;

/** Per-field animated value map for the LLM-update flash. */
function useFieldFlash() {
  const map = useRef<Record<string, Animated.Value>>({});
  const get = (id: string): Animated.Value => {
    if (!map.current[id]) map.current[id] = new Animated.Value(0);
    return map.current[id];
  };
  const flash = (id: string) => {
    const anim = get(id);
    Animated.sequence([
      Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: false }),
      Animated.timing(anim, { toValue: 0, duration: 800, useNativeDriver: false }),
    ]).start();
  };
  return { get, flash };
}

export function OnboardingScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();

  // ── Animations ─────────────────────────────────────────────────────────────
  const orbScale        = useRef(new Animated.Value(1)).current;
  const greetingOpacity = useRef(new Animated.Value(1)).current;
  const formOpacity     = useRef(new Animated.Value(0)).current;
  const formSlide       = useRef(new Animated.Value(-20)).current; // slides in from slightly above

  // ── UI state ───────────────────────────────────────────────────────────────
  const [subtitle,    setSubtitle]    = useState<string>("");
  const [form,        setForm]        = useState<FormArtifact | null>(null);
  const [formValues,  setFormValues]  = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});  const [voiceEnabled, setVoiceEnabled] = useState(true);

  // ── Per-field LLM flash ───────────────────────────────────────────────────────
  const fieldFlash = useFieldFlash();
  // ── Green-orb timing: only activate green when speaking starts ─────────────
  const hasActivatedRef = useRef(false);
  const [orbDisplayStatus, setOrbDisplayStatus] = useState<SessionStatus>("idle");

  const exitingRef = useRef(false);

  // Stable ref so useVoiceSession can be declared before handleArtifact
  const handleArtifactRef = useRef<(artifact: Artifact) => void>(() => {});

  const { status, intent, connect, disconnect, sendUIEvent } = useVoiceSession({
    mode:       "onboarding",
    onArtifact: (artifact) => handleArtifactRef.current(artifact),
  });

  // ── Derive orb display status — green appears WITH the first utterance ──────
  useEffect(() => {
    if (status === "speaking" && !hasActivatedRef.current) {
      hasActivatedRef.current = true;
    }
    setOrbDisplayStatus(hasActivatedRef.current ? status : "idle");
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleArtifact = useCallback((artifact: Artifact) => {
    if (artifact.type === "intent") {
      const text = (artifact as unknown as { text?: string }).text;
      if (text) setSubtitle(text);
    } else if (artifact.type === "form") {
      const formArtifact = artifact as FormArtifact;
      // Orb shrinks; greeting fades out; then form slides in
      Animated.spring(orbScale, { toValue: 0.68, tension: 32, friction: 9, useNativeDriver: true }).start();
      Animated.timing(greetingOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        setForm(formArtifact);
        setFieldErrors({});
        formSlide.setValue(-20);
        formOpacity.setValue(0);
        Animated.parallel([
          Animated.spring(formSlide,  { toValue: 0, tension: 65, friction: 11, useNativeDriver: true }),
          Animated.timing(formOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
        ]).start();
      });
    } else if (artifact.type === "field_update") {
      const update = artifact as FieldUpdateArtifact;
      setFormValues((prev) => ({ ...prev, [update.field_id]: update.value }));
      setFieldErrors((prev) => ({ ...prev, [update.field_id]: false }));
      // Flash the updated field to show the server filled it in
      fieldFlash.flash(update.field_id);
    } else if (artifact.type === "orb_layout") {
      // Form is done — fade it out, restore orb scale
      Animated.timing(formOpacity, { toValue: 0, duration: 200, useNativeDriver: true })
        .start(() => setForm(null));
      Animated.spring(orbScale, { toValue: 1.0, tension: 28, friction: 8, useNativeDriver: true }).start();
    } else if (artifact.type === "navigate") {
      const nav = artifact as unknown as { screen?: string };
      if (!nav.screen || nav.screen === "Onboarding") return;
      finishOnboarding(nav.screen as keyof RootStackParamList);
    }
  }, [orbScale, greetingOpacity, formSlide, formOpacity]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the ref current after every render
  handleArtifactRef.current = handleArtifact;

  useEffect(() => {
    if (intent) setSubtitle(intent);
  }, [intent]);

  // ── Connect voice on mount (skipped when user dismissed voice) ────────────────
  useEffect(() => {
    if (!voiceEnabled) return;
    connect();
    return () => { disconnect(); };
  }, [voiceEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDismissVoice = useCallback(() => {
    disconnect();
    setVoiceEnabled(false);
  }, [disconnect]);

  const finishOnboarding = useCallback(
    (targetScreen: keyof RootStackParamList = "Home") => {
      if (exitingRef.current) return;
      exitingRef.current = true;
      disconnect();
      navigation.reset({ index: 0, routes: [{ name: targetScreen as any }] });
    },
    [disconnect, navigation],
  );

  const handleFormSubmit = useCallback(() => {
    if (!form) return;
    const errors: Record<string, boolean> = {};
    let hasErrors = false;
    for (const f of form.fields) {
      if (f.required && !(formValues[f.id] ?? "").trim()) {
        errors[f.id] = true;
        hasErrors = true;
      }
    }
    if (hasErrors) {
      setFieldErrors(errors);
      const missing = form.fields
        .filter((f) => errors[f.id])
        .map((f) => f.label)
        .join(" and ");
      sendUIEvent("form_validation_error", { missing_fields: missing });
      return;
    }
    sendUIEvent("form_submit", formValues);
  }, [form, formValues, sendUIEvent]);

  const statusLabel =
    status === "connecting" ? "CONNECTING" :
    status === "listening"  ? "LISTENING"  :
    status === "speaking"   ? "SPEAKING"   : "";

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: insets.top }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.wordmark}>prepatu</Text>
        <TouchableOpacity
          onPress={() => finishOnboarding("Home")}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.6}
        >
          <Text style={styles.skipLabel}>Skip</Text>
        </TouchableOpacity>
      </View>

      {/* ── Content (greeting ↔ form) ──────────────────────────────────── */}
      <View style={styles.content}>
        {/* Greeting — shown during intro state */}
        {!form && (
          <Animated.View
            style={[styles.greetingWrap, { opacity: greetingOpacity }]}
            pointerEvents="none"
          >
            <Text style={styles.greetingTitle}>Your IELTS{"\n"}Speaking Guide</Text>
            {!!subtitle && <Text style={styles.greetingSubtitle}>{subtitle}</Text>}
          </Animated.View>
        )}

        {/* Form — shown during collect_info state */}
        {form && (
          <Animated.View
            style={[styles.formWrap, { opacity: formOpacity, transform: [{ translateY: formSlide }] }]}
          >
            <ScrollView
              contentContainerStyle={styles.formContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.formTitle}>Tell us about yourself</Text>
              <Text style={styles.formHint}>Say your answers or type them below</Text>
              {form.fields.map((f, idx) => (
                <View key={f.id} style={styles.fieldGroup}>
                  <View style={styles.fieldLabelRow}>
                    <Text style={styles.fieldLabel}>{f.label}</Text>
                    {f.required && <Text style={styles.fieldRequired}> *</Text>}
                  </View>
                  <Animated.View
                    style={[
                      styles.fieldFlashWrap,
                      {
                        backgroundColor: fieldFlash.get(f.id).interpolate({
                          inputRange: [0, 1],
                          outputRange: ["rgba(0,0,0,0)", colors.fieldUpdate.glow],
                        }),
                        borderColor: fieldFlash.get(f.id).interpolate({
                          inputRange: [0, 1],
                          outputRange: [
                            fieldErrors[f.id] ? colors.orb.error : "rgba(255,255,255,0.06)",
                            colors.fieldUpdate.border,
                          ],
                        }),
                        borderWidth: 1.5,
                        borderRadius: 14,
                      },
                    ]}
                  >
                    <TextInput
                      style={[
                        styles.fieldInput,
                        fieldErrors[f.id] && styles.fieldInputError,
                      ]}
                      placeholder={f.placeholder ?? f.label}
                      placeholderTextColor={colors.text.muted}
                      value={formValues[f.id] ?? ""}
                      onChangeText={(val) => {
                        setFormValues((prev) => ({ ...prev, [f.id]: val }));
                        if (fieldErrors[f.id]) setFieldErrors((prev) => ({ ...prev, [f.id]: false }));
                      }}
                      onSubmitEditing={handleFormSubmit}
                      returnKeyType={idx === form.fields.length - 1 ? "done" : "next"}
                      autoCapitalize={f.id === "first_name" ? "words" : "none"}
                      selectionColor={colors.orb.listening}
                    />
                  </Animated.View>
                  {fieldErrors[f.id] && (
                    <Text style={styles.fieldError}>Required — say it or type it</Text>
                  )}
                </View>
              ))}
              <TouchableOpacity
                style={styles.continueBtn}
                onPress={handleFormSubmit}
                activeOpacity={0.85}
              >
                <Text style={styles.continueBtnLabel}>Continue</Text>
              </TouchableOpacity>
            </ScrollView>
          </Animated.View>
        )}
      </View>

      {/* ── Orb: semi-circle protruding from screen bottom (bottom-arc) ───────── */}
      <View style={[styles.orbFooter, { paddingBottom: Math.max(insets.bottom, 0) }]}>
        {voiceEnabled ? (
          <>
            <Animated.View style={{ transform: [{ scale: orbScale }] }}>
              <VoiceOrb status={orbDisplayStatus} mode="bottom-arc" onPress={handleDismissVoice} />
            </Animated.View>
            <TouchableOpacity
              onPress={handleDismissVoice}
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
        {voiceEnabled && !!statusLabel && <Text style={styles.statusLabel}>{statusLabel}</Text>}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex:            1,
    backgroundColor: colors.background.base,
    flexDirection:   "column",
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
  skipLabel: {
    fontSize:      13,
    color:         colors.text.muted,
    letterSpacing: 0.5,
  },
  content: {
    flex:              1,
    paddingHorizontal: spacing.lg,
  },
  greetingWrap: {
    flex:           1,
    justifyContent: "center",
    alignItems:     "center",
    paddingBottom:  60,
  },
  greetingTitle: {
    fontSize:      34,
    fontWeight:    "200" as const,
    letterSpacing: 0.5,
    color:         colors.text.primary,
    textAlign:     "center",
    lineHeight:    44,
  },
  greetingSubtitle: {
    marginTop:  20,
    fontSize:   16,
    fontWeight: "300" as const,
    color:      colors.text.secondary,
    textAlign:  "center",
  },
  formWrap: {
    flex: 1,
  },
  formContent: {
    paddingTop:    spacing.xl,
    paddingBottom: spacing.xl,
    gap:           spacing.md,
  },
  formTitle: {
    fontSize:     24,
    fontWeight:   "600" as const,
    color:        colors.text.primary,
    marginBottom: 4,
  },
  formHint: {
    fontSize:     14,
    fontWeight:   "300" as const,
    color:        colors.text.secondary,
    marginBottom: spacing.sm,
  },
  fieldGroup: {
    gap: spacing.xs,
  },
  fieldLabelRow: {
    flexDirection: "row",
    alignItems:    "center",
  },
  fieldLabel: {
    fontSize:      12,
    fontWeight:    "600" as const,
    letterSpacing: 1,
    textTransform: "uppercase" as const,
    color:         colors.text.secondary,
    marginLeft:    2,
  },
  fieldRequired: {
    fontSize:   14,
    fontWeight: "700" as const,
    color:      colors.orb.error,
  },
  fieldFlashWrap: {
    // Wrapper for the animated border + bg flash; BorderRadius kept in sync with fieldInput
    borderRadius:  14,
    overflow:      "hidden" as const,
  },
  fieldInput: {
    backgroundColor:   "transparent",
    borderRadius:      14,
    color:             colors.text.primary,
    fontSize:          17,
    paddingHorizontal: spacing.md,
    paddingVertical:   15,
  },
  fieldInputError: {
    // When there is a validation error the Animated.View border takes over;
    // keep this as an empty overrider so the interpolation handles it.
    borderColor: colors.orb.error,
  },
  fieldError: {
    fontSize:   12,
    color:      colors.orb.error,
    marginLeft: 4,
  },
  continueBtn: {
    backgroundColor: colors.orb.listening,
    borderRadius:    16,
    paddingVertical: 16,
    alignItems:      "center",
    marginTop:       spacing.md,
  },
  continueBtnLabel: {
    color:         "#fff",
    fontSize:      16,
    fontWeight:    "600" as const,
    letterSpacing: 0.4,
  },
  orbFooter: {
    alignItems: "center",
    paddingTop: spacing.sm,
    gap:        4,
  },
  noVoiceBtn: {
    paddingTop: 6,
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
