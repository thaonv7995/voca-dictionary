import { Screen } from "../../src/ui";
import { StreamingPanel } from "../../src/streaming-ui";

export default function SpeakingScreen() {
  return (
    <Screen title="Speaking Practice" subtitle="Global Agent">
      <StreamingPanel
        title="Speaking & Shadowing"
        description="Stream English reading passages with synchronized IPA and voice-shadowing playback."
        path="/v1/practice/speaking"
        defaultPrompt="Generate a speaking and shadowing practice task using my vocabulary set."
        scopeEnabled
        recordType="speaking"
      />
    </Screen>
  );
}
