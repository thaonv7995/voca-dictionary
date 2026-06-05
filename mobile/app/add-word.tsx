import { AddVocaForm } from "../src/add-voca";
import { Screen, Card } from "../src/ui";

export default function AddWordScreen() {
  return (
    <Screen title="Add vocabulary" subtitle="Create card">
      <Card>
        <AddVocaForm showDescription />
      </Card>
    </Screen>
  );
}
