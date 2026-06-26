import { Stack } from "expo-router";
import { useEffect } from "react";
import { Text, AppState, AppStateStatus } from "react-native";
import { logClientError } from "../src/logging";
import { colors } from "../src/theme";
import * as VocaNative from "../modules/voca-native";

export default function RootLayout() {
  useEffect(() => {
    const checkAndSpeakPending = () => {
      try {
        const pendingWord = VocaNative.readSharedSetting("voca.speakPendingWord");
        if (pendingWord) {
          VocaNative.speak(pendingWord);
          VocaNative.clearSharedSetting("voca.speakPendingWord");
        }
      } catch (err) {
        console.warn("Failed to check or speak pending word:", err);
      }
    };

    // Run immediately when layout loads
    checkAndSpeakPending();

    // Listen to AppState transitions to foreground
    const subscription = AppState.addEventListener("change", (nextAppState: AppStateStatus) => {
      if (nextAppState === "active") {
        checkAndSpeakPending();
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return (

    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.bg },
        headerStyle: { backgroundColor: colors.panel },
        headerTintColor: colors.ink,
        headerTitleStyle: { fontWeight: "900" },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="cards/[id]"
        options={{
          title: "Card detail",
          headerBackTitle: "Cards",
        }}
      />
      <Stack.Screen name="cards/[id]/agent" options={{ headerShown: false }} />
      <Stack.Screen name="agent/drills" options={{ title: "TOEIC drills" }} />
      <Stack.Screen name="agent/reading" options={{ title: "Reading" }} />
      <Stack.Screen name="agent/article" options={{ title: "Article Practice" }} />
      <Stack.Screen name="agent/speaking" options={{ title: "Speaking Practice" }} />
      <Stack.Screen name="agent/conversation" options={{ headerShown: false }} />
      <Stack.Screen name="add-word" options={{ title: "Add vocabulary" }} />
    </Stack>
  );
}

export function ErrorBoundary({ error }: { error: Error }) {
  useEffect(() => {
    void logClientError(error, "root");
  }, [error]);

  return <Text style={{ color: colors.danger, padding: 24, fontWeight: "800" }}>{error.message}</Text>;
}
