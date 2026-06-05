import { Screen } from "../../src/ui";
import { StreamingPanel } from "../../src/streaming-ui";

export default function DrillsScreen() {
  return (
    <Screen title="TOEIC drills" subtitle="Global Agent">
      <StreamingPanel
        title="Streaming drills"
        description="Generate scenarios, traps, reverse dictionary and Part 2 response drills."
        path="/v1/practice/drills"
        defaultPrompt="Generate 3 TOEIC-style drills from my current vocabulary set."
        scopeEnabled
        recordType="drills"
      />
    </Screen>
  );
}
