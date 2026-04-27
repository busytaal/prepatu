/**
 * MuteControls — fixed bottom bar with mic and speaker mute toggles.
 *
 * When both are muted (voiceless mode) a thin amber banner appears above
 * the buttons to remind the user they can still tap action pills.
 *
 * Icons are Unicode glyphs — no icon library required.
 */
import React from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { colors, spacing, typography } from "../design/tokens";

interface Props {
  micMuted: boolean;
  spkMuted: boolean;
  onToggleMic: () => void;
  onToggleSpk: () => void;
}

export function MuteControls({ micMuted, spkMuted, onToggleMic, onToggleSpk }: Props) {
  const voiceless = micMuted && spkMuted;

  return (
    <View style={styles.root}>
      {/* Voiceless mode banner */}
      {voiceless && (
        <View style={styles.voicelessBanner}>
          <Text style={styles.voicelessText}>voiceless — tap actions to continue</Text>
        </View>
      )}

      {/* Button row */}
      <View style={styles.row}>
        {/* Mic mute */}
        <TouchableOpacity
          style={[styles.pill, micMuted && styles.pillMuted]}
          onPress={onToggleMic}
          activeOpacity={0.75}
          accessibilityLabel={micMuted ? "Unmute microphone" : "Mute microphone"}
          accessibilityRole="button"
        >
          <Text style={[styles.icon, micMuted && styles.iconMuted]}>
            {micMuted ? "🎙️✕" : "🎙️"}
          </Text>
        </TouchableOpacity>

        {/* Speaker mute */}
        <TouchableOpacity
          style={[styles.pill, spkMuted && styles.pillMuted]}
          onPress={onToggleSpk}
          activeOpacity={0.75}
          accessibilityLabel={spkMuted ? "Unmute speaker" : "Mute speaker"}
          accessibilityRole="button"
        >
          <Text style={[styles.icon, spkMuted && styles.iconMuted]}>
            {spkMuted ? "🔇" : "🔊"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex:              1,           // take up remaining space in bottomBar row
    paddingLeft:       spacing.lg,
    paddingBottom:     spacing.sm,
    gap:               spacing.sm,
  },
  voicelessBanner: {
    backgroundColor: "rgba(232,160,32,0.10)",
    borderWidth: 1,
    borderColor: "rgba(232,160,32,0.25)",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    alignItems: "center",
  },
  voicelessText: {
    color: colors.mute.muted,
    fontSize: 11,
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: "row",
    gap: spacing.md,
    height: spacing.controlsBarHeight,
    alignItems: "center",
  },
  pill: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.background.surface,
    borderWidth: 1,
    borderColor: colors.background.elevated,
    alignItems: "center",
    justifyContent: "center",
  },
  pillMuted: {
    backgroundColor: colors.mute.mutedBg,
    borderColor: "rgba(232,160,32,0.35)",
  },
  icon: {
    fontSize: 20,
    color: colors.mute.active,
  },
  iconMuted: {
    color: colors.mute.muted,
  },
});
