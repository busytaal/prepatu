/**
 * VoiceOrb — communicates voice pipeline state through colour, scale,
 * glow, and (when listening) a thin rotating ring.
 *
 * Mode drives position/size:
 *   corner  → large quarter-circle from bottom-right  (home / idle)
 *   side    → small circle on the right edge          (assistant active)
 *   centre  → medium circle centred on screen         (interview active)
 *
 * States → colour:
 *   idle        → dim grey
 *   connecting  → amber breathe
 *   listening   → green breathe + rotating ring
 *   speaking    → blue fast pulse
 *   error       → red still
 */
import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, TouchableOpacity, View } from "react-native";
import { colors, orbSizes, animation } from "../design/tokens";
import type { SessionStatus } from "../hooks/useVoiceSession";

export type OrbMode = "corner" | "side" | "centre" | "bottom-arc";

interface Props {
  status:         SessionStatus;
  mode?:          OrbMode;
  /** Fires a quick burst on the orb when incremented (Eventually LLM artifact). */
  artifactBadge?: number;
  /** @deprecated use mode="corner" */
  corner?:        boolean;
  onPress?:       () => void;
}

function resolveMode(mode: OrbMode | undefined, corner: boolean | undefined): OrbMode {
  if (mode) return mode;
  if (corner) return "corner";
  return "centre";
}

// ── Size helpers ──────────────────────────────────────────────────────────────
function sizes(orbMode: OrbMode) {
  if (orbMode === "corner")     return orbSizes.corner;
  if (orbMode === "side")       return orbSizes.side;
  if (orbMode === "bottom-arc") return orbSizes.bottomArc;
  return orbSizes.centre;
}

// ─── Colour maps from tokens ───────────────────────────────────────────────────
type ExtendedStatus = SessionStatus | "mutedMic" | "mutedSpk";
const STATE_COLOR: Record<ExtendedStatus, string> = {
  idle:       colors.orb.idle,
  connecting: colors.orb.connecting,
  connected:  colors.orb.connected,
  listening:  colors.orb.listening,
  speaking:   colors.orb.speaking,
  error:      colors.orb.error,
  ended:      colors.orb.ended,
  maintenance:colors.orb.idle,
  mutedMic:   colors.orb.mutedMic,
  mutedSpk:   colors.orb.mutedSpk,
};
const GLOW_COLOR: Record<ExtendedStatus, string> = {
  idle:        colors.glow.idle,
  connecting:  colors.glow.connecting,
  connected:   colors.glow.connected,
  listening:   colors.glow.listening,
  speaking:    colors.glow.speaking,
  error:       colors.glow.error,
  ended:       colors.glow.ended,
  maintenance: colors.glow.idle,
  mutedMic:    colors.glow.mutedMic,
  mutedSpk:    colors.glow.mutedSpk,
};

export function VoiceOrb({ status, mode, corner, artifactBadge = 0, onPress }: Props) {
  const orbMode  = resolveMode(mode, corner);
  const { orb: ORB_SIZE, glow: GLOW_SIZE } = sizes(orbMode);

  const scale     = useRef(new Animated.Value(1)).current;
  const glowOpac  = useRef(new Animated.Value(0)).current;
  const burst     = useRef(new Animated.Value(1)).current;
  const ringOpac  = useRef(new Animated.Value(0)).current;
  const ringRot   = useRef(new Animated.Value(0)).current;
  const loopRef   = useRef<Animated.CompositeAnimation | null>(null);
  const ringRef   = useRef<Animated.CompositeAnimation | null>(null);

  // ── Core pulse animation ───────────────────────────────────────────────────
  useEffect(() => {
    loopRef.current?.stop();
    ringRef.current?.stop();

    if (status === "speaking") {
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.18, duration: animation.speakPulseDuration, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 0.96, duration: animation.speakPulseDuration, useNativeDriver: true }),
        ])
      );
      Animated.timing(glowOpac, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      Animated.timing(ringOpac, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      loopRef.current.start();
    } else if (status === "listening") {
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.08, duration: animation.listenBreathDuration, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 0.98, duration: animation.listenBreathDuration, useNativeDriver: true }),
        ])
      );
      Animated.timing(glowOpac, { toValue: 1, duration: 400, useNativeDriver: true }).start();
      // Listening ring — rotates slowly
      Animated.timing(ringOpac, { toValue: 0.7, duration: 350, useNativeDriver: true }).start();
      ringRef.current = Animated.loop(
        Animated.timing(ringRot, { toValue: 1, duration: animation.listenBreathDuration * 1.75, easing: (t) => t, useNativeDriver: true })
      );
      ringRef.current.start();
      loopRef.current.start();
    } else if (status === "connecting") {
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.06, duration: 700, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 0.97, duration: 700, useNativeDriver: true }),
        ])
      );
      Animated.timing(glowOpac, { toValue: 0.6, duration: 400, useNativeDriver: true }).start();
      Animated.timing(ringOpac, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      loopRef.current.start();
    } else {
      Animated.parallel([
        Animated.timing(scale,    { toValue: 1.0, duration: 250, useNativeDriver: true }),
        Animated.timing(glowOpac, { toValue: 0,   duration: 350, useNativeDriver: true }),
        Animated.timing(ringOpac, { toValue: 0,   duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Burst on new artifact ──────────────────────────────────────────────────
  useEffect(() => {
    if (artifactBadge === 0) return;
    Animated.sequence([
      Animated.timing(burst, { toValue: 1.35, duration: 160, useNativeDriver: true }),
      Animated.timing(burst, { toValue: 1.0,  duration: 200, useNativeDriver: true }),
    ]).start();
  }, [artifactBadge]); // eslint-disable-line react-hooks/exhaustive-deps

  const orbColor  = STATE_COLOR[status] ?? STATE_COLOR.idle;
  const glowColor = GLOW_COLOR[status]  ?? GLOW_COLOR.idle;

  const ringSize  = ORB_SIZE + 12; // 6px gap on each side
  const ringRotDeg = ringRot.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  // ── Corner variant ─────────────────────────────────────────────────────────
  if (orbMode === "corner") {
    const GLOW_CORNER = ORB_SIZE + 44;
    const inner = (
      <View style={{ width: ORB_SIZE, height: ORB_SIZE, overflow: "visible" }}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              width: GLOW_CORNER, height: GLOW_CORNER,
              borderTopLeftRadius: GLOW_CORNER,
              borderTopRightRadius: 0, borderBottomRightRadius: 0, borderBottomLeftRadius: 0,
              backgroundColor: glowColor,
              opacity: glowOpac,
              bottom: 0, right: 0, position: "absolute",
            },
          ]}
        />
        <Animated.View
          style={{
            width: ORB_SIZE, height: ORB_SIZE,
            borderTopLeftRadius: ORB_SIZE,
            borderTopRightRadius: 0, borderBottomRightRadius: 0, borderBottomLeftRadius: 0,
            backgroundColor: orbColor,
            transform: [{ scale: Animated.multiply(scale, burst) }],
            elevation: 14,
            shadowColor: "#000",
            shadowOffset: { width: -3, height: -3 },
            shadowOpacity: 0.4,
            shadowRadius: 12,
          }}
        />
      </View>
    );
    if (onPress) return <TouchableOpacity onPress={onPress} activeOpacity={0.82}>{inner}</TouchableOpacity>;
    return inner;
  }
  // ── Bottom-arc: semi-circle protruding from the screen bottom ──────────────────
  if (orbMode === "bottom-arc") {
    const ARC_W  = ORB_SIZE;          // diameter
    const ARC_H  = ORB_SIZE / 2;     // visible height (top half only)
    const GLOW_W = GLOW_SIZE;
    const GLOW_H = GLOW_SIZE / 2;
    const glowOffsetLeft = (GLOW_W - ARC_W) / 2;

    const arc = (
      <View style={{ width: ARC_W, height: ARC_H, overflow: "visible", alignItems: "center" }}>
        {/* Glow halo — same semi-circle shape, larger, behind the orb */}
        <Animated.View
          style={{
            position:              "absolute",
            width:                 GLOW_W,
            height:                GLOW_H,
            borderTopLeftRadius:   GLOW_W / 2,
            borderTopRightRadius:  GLOW_W / 2,
            borderBottomLeftRadius:  0,
            borderBottomRightRadius: 0,
            backgroundColor:       glowColor,
            opacity:               glowOpac,
            bottom:                0,
            left:                  -glowOffsetLeft,
          }}
        />
        {/* Core semi-circle */}
        <Animated.View
          style={{
            width:                 ARC_W,
            height:                ARC_H,
            borderTopLeftRadius:   ARC_W / 2,
            borderTopRightRadius:  ARC_W / 2,
            borderBottomLeftRadius:  0,
            borderBottomRightRadius: 0,
            backgroundColor:       orbColor,
            transform:             [{ scaleY: Animated.multiply(scale, burst) as any }],
            elevation:             16,
            shadowColor:           "#000",
            shadowOffset:          { width: 0, height: -4 },
            shadowOpacity:         0.35,
            shadowRadius:          14,
          }}
        />
      </View>
    );

    if (onPress) return <TouchableOpacity onPress={onPress} activeOpacity={0.82}>{arc}</TouchableOpacity>;
    return arc;
  }
  // ── Side + centre circular variants ───────────────────────────────────────
  const wrapSize = Math.max(GLOW_SIZE, ringSize + 4);
  return (
    <View style={{ width: wrapSize, height: wrapSize, alignItems: "center", justifyContent: "center" }}>
      {/* Glow */}
      <Animated.View
        style={{
          position: "absolute",
          width: GLOW_SIZE, height: GLOW_SIZE,
          borderRadius: GLOW_SIZE / 2,
          backgroundColor: glowColor,
          opacity: glowOpac,
        }}
      />
      {/* Listening ring */}
      <Animated.View
        style={{
          position: "absolute",
          width: ringSize, height: ringSize,
          borderRadius: ringSize / 2,
          borderWidth: 1.5,
          borderColor: colors.listeningRing,
          opacity: ringOpac,
          transform: [{ rotate: ringRotDeg }],
        }}
      />
      {/* Core orb */}
      <Animated.View
        style={{
          width: ORB_SIZE, height: ORB_SIZE,
          borderRadius: ORB_SIZE / 2,
          backgroundColor: orbColor,
          transform: [{ scale: Animated.multiply(scale, burst) }],
          elevation: 6,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.35,
          shadowRadius: 6,
        }}
      />
    </View>
  );
}
