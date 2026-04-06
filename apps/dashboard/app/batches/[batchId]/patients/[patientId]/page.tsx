import { redirect } from "next/navigation";

export default async function LegacyBatchPatientPage({
  params,
}: {
  params: Promise<{ batchId: string; patientId: string }>;
}) {
  const { batchId, patientId } = await params;
  redirect(`/runs/${batchId}/patients/${patientId}`);
}
