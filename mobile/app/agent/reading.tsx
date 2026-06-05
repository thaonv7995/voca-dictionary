import { Screen } from "../../src/ui";
import { StreamingPanel } from "../../src/streaming-ui";

export default function ReadingScreen() {
  return (
    <Screen title="Reading" subtitle="Part 6 / Part 7">
      <StreamingPanel
        title="Reading context"
        description="Stream TOEIC Part 6/7 context and questions."
        path="/v1/practice/reading"
        defaultPrompt="Generate a TOEIC Part 7 reading passage with 3 questions."
        scopeEnabled
        recordType="reading"
      />
    </Screen>
  );
}
