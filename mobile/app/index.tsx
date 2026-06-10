import { Redirect, Stack, useRootNavigationState } from "expo-router";
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { colors } from "../src/theme";

export default function IndexRoute() {
  const rootNavigationState = useRootNavigationState();

  if (!rootNavigationState?.key) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.bg }}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return <Redirect href="/(tabs)/today" />;
}
