/**
 * ActionPills — horizontal scrollable row of tappable pill buttons.
 *
 * Renders options from an OptionsArtifact. Screens place this between
 * the content area and the mute controls bar.
 *
 * The last pill in the list named "End" or "Exit" is styled as a danger pill.
 */
import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { colors, spacing, typography } from "../design/tokens";
import type { OptionsArtifact } from "../types/artifacts";

interface Props {
  artifact: OptionsArtifact | null;
  onAction: (artifactId: string, optionId: string) => void;
}

const DANGER_LABELS = new Set(["end", "exit", "quit", "stop", "end session", "leave"]);

function isDanger(label: string) {
  return DANGER_LABELS.has(label.toLowerCase().trim());
}

export function ActionPills({ artifact, onAction }: Props) {
  if (!artifact || artifact.options.length === 0) return null;

  return (
    <View style={styles.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled"
      >
        {artifact.options.map((opt) => {
          const danger = isDanger(opt.label);
          return (
            <TouchableOpacity
              key={opt.id}
              style={[styles.pill, danger && styles.pillDanger]}
              activeOpacity={0.7}
              onPress={() => onAction(artifact.id, opt.id)}
              accessibilityLabel={opt.label}
              accessibilityRole="button"
            >
              <Text style={[styles.label, danger && styles.labelDanger]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection:  "row",
    gap:            spacing.actionGap,
    paddingHorizontal: spacing.md,
    alignItems:     "center",
  },
  pill: {
    backgroundColor:  colors.action.bg,
    borderWidth:      1,
    borderColor:      colors.action.border,
    borderRadius:     999,
    paddingVertical:  10,
    paddingHorizontal: 18,
    minWidth:         80,
    alignItems:       "center",
    // subtle shadow
    shadowColor:      "#000",
    shadowOffset:     { width: 0, height: 2 },
    shadowOpacity:    0.25,
    shadowRadius:     4,
    elevation:        3,
  },
  pillDanger: {
    backgroundColor: colors.action.bgDanger,
    borderColor:     "rgba(231,76,60,0.25)",
  },
  label: {
    fontSize:      typography.actionLabel.fontSize,
    fontWeight:    typography.actionLabel.fontWeight,
    letterSpacing: typography.actionLabel.letterSpacing,
    color:         colors.action.label,
  },
  labelDanger: {
    color: colors.action.labelDanger,
  },
});
