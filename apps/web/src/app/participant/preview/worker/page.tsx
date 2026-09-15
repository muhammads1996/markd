import { getParticipantFixtures } from "../../../../lib/participant/fixtures";
import { isWorkerScenario, isWorkerView } from "../preview-query";
import WorkerPreview from "./worker-preview";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function WorkerPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const viewValue = first(params.view);
  const scenarioValue = first(params.scenario);
  return (
    <WorkerPreview
      fixtures={getParticipantFixtures()}
      initialView={isWorkerView(viewValue) ? viewValue : "home"}
      initialScenario={
        isWorkerScenario(scenarioValue) ? scenarioValue : "travel_ready"
      }
    />
  );
}
