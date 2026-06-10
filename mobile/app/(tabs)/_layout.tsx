import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import { Platform, View } from "react-native";
import { ListeningPlayerProvider } from "../../src/listening-player";
import { CardsLibraryProvider } from "../../src/useCards";
import { colors, radius, shadows, spacing } from "../../src/theme";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const TAB_CONFIG: Array<{
  name: string;
  title: string;
  icon: IoniconName;
  iconActive: IoniconName;
}> = [
  { name: "today", title: "Today", icon: "home-outline", iconActive: "home" },
  { name: "cards", title: "Cards", icon: "albums-outline", iconActive: "albums" },
  { name: "agent", title: "Agent", icon: "sparkles-outline", iconActive: "sparkles" },
  { name: "listen", title: "Listen", icon: "headset-outline", iconActive: "headset" },
  { name: "settings", title: "More", icon: "settings-outline", iconActive: "settings" },
];

export default function TabsLayout() {
  return (
    <CardsLibraryProvider>
      <ListeningPlayerProvider>
        <View style={{ flex: 1 }}>
          <Tabs
            screenOptions={{
              headerShown: false,
              tabBarActiveTintColor: colors.accent,
              tabBarInactiveTintColor: colors.mutedLight,
              tabBarStyle: {
                borderTopWidth: 1,
                borderTopColor: colors.lineSoft,
                backgroundColor: colors.panel,
                height: Platform.OS === "ios" ? 82 : 64,
                paddingBottom: Platform.OS === "ios" ? 24 : 10,
                paddingTop: 8,
                ...shadows.sm,
              },
              tabBarLabelStyle: {
                fontSize: 10,
                fontWeight: "700",
                letterSpacing: 0.2,
                marginTop: 2,
              },
            }}
          >
            {TAB_CONFIG.map((tab) => (
              <Tabs.Screen
                key={tab.name}
                name={tab.name}
                options={{
                  title: tab.title,
                  tabBarIcon: ({ color, focused }) => (
                    <TabIcon
                      color={color}
                      focused={focused}
                      iconActive={tab.iconActive}
                      iconInactive={tab.icon}
                    />
                  ),
                }}
              />
            ))}
          </Tabs>
        </View>
      </ListeningPlayerProvider>
    </CardsLibraryProvider>
  );
}

function TabIcon({
  color,
  focused,
  iconActive,
  iconInactive,
}: {
  color: string;
  focused: boolean;
  iconActive: IoniconName;
  iconInactive: IoniconName;
}) {
  return (
    <View style={{ alignItems: "center", gap: 2 }}>
      <Ionicons
        color={color}
        name={focused ? iconActive : iconInactive}
        size={22}
      />
      {focused ? (
        <View
          style={{
            width: 4,
            height: 4,
            borderRadius: radius.full,
            backgroundColor: colors.accent,
          }}
        />
      ) : (
        <View style={{ width: 4, height: 4 }} />
      )}
    </View>
  );
}
