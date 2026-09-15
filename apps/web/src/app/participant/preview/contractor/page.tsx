import { getParticipantFixtures } from "../../../../lib/participant/fixtures";
import { isContractorView } from "../preview-query";
import ContractorPreview from "./contractor-preview";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ContractorPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewValue = first((await searchParams).view);
  return (
    <ContractorPreview
      fixtures={getParticipantFixtures()}
      initialView={isContractorView(viewValue) ? viewValue : "home"}
    />
  );
}
