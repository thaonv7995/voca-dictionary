import { Tabs } from "expo-router";
import { Text, View } from "react-native";
import { ListeningPlayerProvider } from "../../src/listening-player";
import { CardsLibraryProvider } from "../../src/useCards";
import { colors } from "../../src/theme";

export default function TabsLayout() {
  return (
    <CardsLibraryProvider>
      <ListeningPlayerProvider>
        <View style={{ flex: 1 }}>
          <Tabs
            screenOptions={{
              headerShown: false,
              tabBarActiveTintColor: colors.accentStrong,
              tabBarInactiveTintColor: colors.muted,
              tabBarStyle: {
                borderTopColor: colors.line,
                backgroundColor: colors.panel,
              },
              tabBarLabelStyle: {
                fontSize: 11,
                fontWeight: "800",
              },
            }}
          >
            <Tabs.Screen name="today" options={{ title: "Today", tabBarIcon: ({ color }) => <TabIcon color={color} label="⌂" /> }} />
            <Tabs.Screen name="cards" options={{ title: "Cards", tabBarIcon: ({ color }) => <TabIcon color={color} label="▣" /> }} />
            <Tabs.Screen name="agent" options={{ title: "Agent", tabBarIcon: ({ color }) => <TabIcon color={color} label="✦" /> }} />
            <Tabs.Screen name="listen" options={{ title: "Listen", tabBarIcon: ({ color }) => <TabIcon color={color} label="▶" /> }} />
            <Tabs.Screen name="settings" options={{ title: "More", tabBarIcon: ({ color }) => <TabIcon color={color} label="⚙" /> }} />
          </Tabs>
        </View>
      </ListeningPlayerProvider>
    </CardsLibraryProvider>
  );
}

function TabIcon({ color, label }: { color: string; label: string }) {
  return <Text style={{ color, fontWeight: "900" }}>{label}</Text>;
}
