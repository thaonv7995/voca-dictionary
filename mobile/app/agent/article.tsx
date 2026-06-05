import { Screen } from "../../src/ui";
import { StreamingPanel } from "../../src/streaming-ui";

export default function ArticleScreen() {
  return (
    <Screen title="Article Practice" subtitle="Global Agent">
      <StreamingPanel
        title="Study then answer"
        description="Stream article practice with vocabulary notes and questions."
        path="/v1/practice/article"
        defaultPrompt="Generate an article practice task using my vocabulary set."
        scopeEnabled
        recordType="article"
      />
    </Screen>
  );
}
