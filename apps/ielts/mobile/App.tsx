import React, { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { View, ActivityIndicator, Text, StyleSheet } from "react-native";

import { getDeviceId }       from "./src/utils/deviceId";
import { SERVER_URL }        from "./src/config";
import { colors, spacing, typography } from "./src/design/tokens";
import { VoiceSessionProvider } from "./src/contexts/VoiceSessionContext";

type BootStage = "static" | "nav" | "home-shell" | "home-track" | "home-orb" | "home" | "onboarding-only" | "all-routes-home" | "full";

// Temporary startup bisect switch. Move upward from "static" -> "nav" -> "home-shell" -> "home-track" -> "home-orb" -> "home" -> "onboarding-only" -> "all-routes-home" -> "full".
const DEBUG_BOOT_STAGE: BootStage = "full";
const STARTUP_FETCH_TIMEOUT_MS = 4000;
const OFFLINE_POLL_INTERVAL_MS = 4000;
const ONLINE_POLL_INTERVAL_MS = 30000;
const HEALTHCHECK_TIMEOUT_MS = 2500;

// ─── Navigation types ────────────────────────────────────────────────────────
export type RootStackParamList = {
  /**
   * Onboarding is in the type map so navigate() is type-safe, but it is
   * intentionally excluded from the LLM's screen enum in artifacts.py.
   * It is only ever reached programmatically (app launch gate below).
   */
  Onboarding: undefined;
  Home:       undefined;
  Assistant:  undefined;
  Interview:  { interviewType?: string };
  Practice:   { programId: string; programName?: string; programAccent?: string };
  History:    undefined;
  Profile:    undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function loadHomeScreen() {
  return require("./src/screens/HomeScreen").HomeScreen as React.ComponentType<unknown>;
}

function loadAssistantScreen() {
  return require("./src/screens/AssistantScreen").AssistantScreen as React.ComponentType<unknown>;
}

function loadInterviewScreen() {
  return require("./src/screens/InterviewScreen").InterviewScreen as React.ComponentType<unknown>;
}

function loadOnboardingScreen() {
  return require("./src/screens/OnboardingScreen").OnboardingScreen as React.ComponentType<unknown>;
}

function loadPracticeScreen() {
  return require("./src/screens/PracticeScreen").PracticeScreen as React.ComponentType<unknown>;
}

function loadHistoryScreen() {
  return require("./src/screens/HistoryScreen").HistoryScreen as React.ComponentType<unknown>;
}

function loadProfileScreen() {
  return require("./src/screens/ProfileScreen").ProfileScreen as React.ComponentType<unknown>;
}

function loadVoiceOrb() {
  return require("./src/components/VoiceOrb").VoiceOrb as React.ComponentType<{
    status: "idle" | "connecting" | "connected" | "speaking" | "listening" | "error" | "ended" | "maintenance";
    mode?: "corner" | "side" | "centre";
    onPress?: () => void;
  }>;
}

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  // null = still loading, true/false = resolved
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;

    const probe = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEALTHCHECK_TIMEOUT_MS);
      try {
        const res = await fetch(`${SERVER_URL}/health`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (active) setBackendOnline(res.ok);
      } catch {
        if (active) setBackendOnline(false);
      } finally {
        clearTimeout(timer);
      }
    };

    void probe();
    const intervalMs = backendOnline ? ONLINE_POLL_INTERVAL_MS : OFFLINE_POLL_INTERVAL_MS;
    const interval = setInterval(() => {
      void probe();
    }, intervalMs);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [backendOnline]);

  useEffect(() => {
    if (DEBUG_BOOT_STAGE !== "full") {
      setOnboardingDone(true);
      return;
    }

    if (backendOnline !== true) {
      return;
    }

    (async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), STARTUP_FETCH_TIMEOUT_MS);

      try {
        const deviceId = await getDeviceId();
        const res  = await fetch(`${SERVER_URL}/app-state?device_id=${deviceId}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`app-state ${res.status}`);
        const data = await res.json();
        // Backend can force onboarding regardless of persisted device flags.
        if (data?.force_onboarding === true) {
          setOnboardingDone(false);
        } else {
          setOnboardingDone(!!data.onboarding_completed);
        }
      } catch {
        // If /app-state is unavailable, try /config as a secondary override channel.
        // This keeps force-onboarding working even when app-state fails upstream.
        try {
          const cfgRes = await fetch(`${SERVER_URL}/config`);
          if (cfgRes.ok) {
            const cfg = await cfgRes.json();
            if (cfg?.force_onboarding === true) {
              setOnboardingDone(false);
              return;
            }
          }
        } catch {
          // Ignore and fall through to default.
        }

        // Network unavailable or no override — skip onboarding gate rather than blocking the user.
        setOnboardingDone(true);
      } finally {
        clearTimeout(timeoutId);
      }
    })();
  }, [backendOnline]);

  useEffect(() => {
    if (DEBUG_BOOT_STAGE !== "home-track") return;

    (async () => {
      try {
        const deviceId = await getDeviceId();
        await fetch(`${SERVER_URL}/user-context`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            device_id:  deviceId,
            event_type: "screen_visited",
            data:       { screen: "Home" },
          }),
        });
      } catch {
        // Startup isolation: tracking failures should never block UI.
      }
    })();
  }, []);

  if (DEBUG_BOOT_STAGE === "static") {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <View style={{ flex: 1, backgroundColor: "#0A0A14", justifyContent: "center", alignItems: "center", padding: 24 }}>
          <Text style={{ color: "#ffffff", fontSize: 24, fontWeight: "700", marginBottom: 8 }}>prepatu</Text>
          <Text style={{ color: "#a0a0b8", textAlign: "center" }}>startup isolation: static shell</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  if (backendOnline === false) {
    const VoiceOrb = loadVoiceOrb();

    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <View style={styles.offlineScreen}>
          <View style={styles.wordmarkWrap}>
            <Text style={styles.wordmark}>prepatu</Text>
            <Text style={styles.subtitle}>voice companion</Text>
          </View>

          <View style={styles.orbWrap}>
            <VoiceOrb status="connecting" mode="centre" />
            <Text style={styles.statusLabel}>OFFLINE</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>No network connection</Text>
            <Text style={styles.cardBody}>
              Prepatu will reconnect automatically when your phone returns to Wi-Fi or mobile data.
            </Text>
            <Text style={styles.cardHint}>server: {SERVER_URL}</Text>
          </View>
        </View>
      </SafeAreaProvider>
    );
  }

  if (onboardingDone === null) {
    // Splash/loading state — show a blank screen until we know where to go
    return (
      <View style={{ flex: 1, backgroundColor: "#0A0A14", justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color="#ffffff" />
      </View>
    );
  }

  if (DEBUG_BOOT_STAGE === "nav") {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName="Home"
            screenOptions={{
              headerShown:  false,
              contentStyle: { backgroundColor: "#0A0A14" },
              animation:    "fade",
            }}
          >
            <Stack.Screen
              name="Home"
              component={() => (
                <View style={{ flex: 1, backgroundColor: "#0A0A14", justifyContent: "center", alignItems: "center", padding: 24 }}>
                  <Text style={{ color: "#ffffff", fontSize: 24, fontWeight: "700", marginBottom: 8 }}>prepatu</Text>
                  <Text style={{ color: "#a0a0b8", textAlign: "center" }}>startup isolation: navigation shell</Text>
                </View>
              )}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    );
  }

  if (DEBUG_BOOT_STAGE === "home-shell") {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName="Home"
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: "#0A0A14" },
              animation: "fade",
            }}
          >
            <Stack.Screen
              name="Home"
              component={() => (
                <View style={{ flex: 1, backgroundColor: "#0A0A14", paddingTop: 56, paddingBottom: 24 }}>
                  <View style={{ position: "absolute", top: 56, left: 24 }}>
                    <Text style={{ color: "#ffffff", fontSize: 28, fontWeight: "700", letterSpacing: 1.5 }}>prepatu</Text>
                    <Text style={{ color: "#444458", fontSize: 12, marginTop: 6, letterSpacing: 1 }}>tap to speak</Text>
                  </View>
                  <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
                    <Text style={{ color: "#a0a0b8", textAlign: "center" }}>startup isolation: home shell</Text>
                  </View>
                </View>
              )}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    );
  }

  if (DEBUG_BOOT_STAGE === "home-track") {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName="Home"
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: "#0A0A14" },
              animation: "fade",
            }}
          >
            <Stack.Screen
              name="Home"
              component={() => (
                <View style={{ flex: 1, backgroundColor: "#0A0A14", paddingTop: 56, paddingBottom: 24 }}>
                  <View style={{ position: "absolute", top: 56, left: 24 }}>
                    <Text style={{ color: "#ffffff", fontSize: 28, fontWeight: "700", letterSpacing: 1.5 }}>prepatu</Text>
                    <Text style={{ color: "#444458", fontSize: 12, marginTop: 6, letterSpacing: 1 }}>tap to speak</Text>
                  </View>
                  <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
                    <Text style={{ color: "#a0a0b8", textAlign: "center" }}>startup isolation: home shell + tracking</Text>
                  </View>
                </View>
              )}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    );
  }

  if (DEBUG_BOOT_STAGE === "home-orb") {
    const VoiceOrb = loadVoiceOrb();

    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName="Home"
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: "#0A0A14" },
              animation: "fade",
            }}
          >
            <Stack.Screen
              name="Home"
              component={() => (
                <View style={{ flex: 1, backgroundColor: "#0A0A14", paddingTop: 56, paddingBottom: 24 }}>
                  <View style={{ position: "absolute", top: 56, left: 24 }}>
                    <Text style={{ color: "#ffffff", fontSize: 28, fontWeight: "700", letterSpacing: 1.5 }}>prepatu</Text>
                    <Text style={{ color: "#444458", fontSize: 12, marginTop: 6, letterSpacing: 1 }}>tap to speak</Text>
                  </View>
                  <View style={{ position: "absolute", bottom: 0, right: 0 }}>
                    <VoiceOrb status="idle" mode="corner" />
                  </View>
                </View>
              )}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    );
  }

  const HomeScreen = loadHomeScreen();

  if (DEBUG_BOOT_STAGE === "home") {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName="Home"
            screenOptions={{
              headerShown:  false,
              contentStyle: { backgroundColor: "#0A0A14" },
              animation:    "fade",
            }}
          >
            <Stack.Screen name="Home" component={HomeScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    );
  }

  const OnboardingScreen = loadOnboardingScreen();

  if (DEBUG_BOOT_STAGE === "onboarding-only") {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName="Onboarding"
            screenOptions={{
              headerShown:  false,
              contentStyle: { backgroundColor: "#0A0A14" },
              animation:    "fade",
            }}
          >
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
            <Stack.Screen name="Home" component={HomeScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    );
  }

  const AssistantScreen = loadAssistantScreen();
  const InterviewScreen = loadInterviewScreen();
  const PracticeScreen  = loadPracticeScreen();
  const HistoryScreen   = loadHistoryScreen();
  const ProfileScreen   = loadProfileScreen();

  if (DEBUG_BOOT_STAGE === "all-routes-home") {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName="Home"
            screenOptions={{
              headerShown:  false,
              contentStyle: { backgroundColor: "#0A0A14" },
              animation:    "fade",
            }}
          >
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Assistant" component={AssistantScreen} />
            <Stack.Screen name="Interview" component={InterviewScreen} />
            <Stack.Screen name="Practice"  component={PracticeScreen} />
            <Stack.Screen name="History"   component={HistoryScreen} />
            <Stack.Screen name="Profile"   component={ProfileScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <VoiceSessionProvider enabled={!!onboardingDone}>
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName={onboardingDone ? "Home" : "Onboarding"}
            screenOptions={{
              headerShown:  false,
              contentStyle: { backgroundColor: "#0A0A14" },
              animation:    "fade",
            }}
          >
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
            <Stack.Screen name="Home"       component={HomeScreen} />
            <Stack.Screen name="Assistant"  component={AssistantScreen} />
            <Stack.Screen name="Interview"  component={InterviewScreen} />
            <Stack.Screen name="Practice"   component={PracticeScreen} />
            <Stack.Screen name="History"    component={HistoryScreen} />
            <Stack.Screen name="Profile"    component={ProfileScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </VoiceSessionProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  offlineScreen: {
    flex: 1,
    backgroundColor: colors.background.base,
    paddingHorizontal: spacing.lg,
    justifyContent: "space-between",
    paddingTop: 56,
    paddingBottom: 40,
  },
  wordmarkWrap: {
    alignSelf: "flex-start",
  },
  wordmark: {
    fontSize: typography.wordmark.fontSize,
    fontWeight: typography.wordmark.fontWeight,
    letterSpacing: typography.wordmark.letterSpacing,
    color: typography.wordmark.color,
  },
  subtitle: {
    marginTop: spacing.sm,
    color: colors.text.muted,
    letterSpacing: 1,
    textTransform: "uppercase",
    fontSize: 11,
  },
  orbWrap: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  statusLabel: {
    color: colors.orb.connecting,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "600",
  },
  card: {
    backgroundColor: colors.background.surface,
    borderColor: colors.action.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: {
    color: colors.text.primary,
    fontSize: 20,
    fontWeight: "600",
  },
  cardBody: {
    color: colors.text.secondary,
    fontSize: 14,
    lineHeight: 20,
  },
  cardHint: {
    marginTop: spacing.sm,
    color: colors.text.muted,
    fontSize: 12,
  },
});


