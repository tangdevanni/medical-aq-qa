import path from "node:path";
import { buildArtifactQualitySummary } from "../services/artifactQualitySummaryService";

function parseArgs(argv: string[]): {
  artifactRoots: string[];
  outputPath: string;
} {
  const artifactRoots: string[] = [];
  let outputPath: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--artifacts-root") {
      const artifactRoot = argv[index + 1];
      if (!artifactRoot) {
        throw new Error("Missing value for --artifacts-root.");
      }
      artifactRoots.push(path.resolve(artifactRoot));
      index += 1;
      continue;
    }
    if (value === "--output-path") {
      const candidate = argv[index + 1];
      if (!candidate) {
        throw new Error("Missing value for --output-path.");
      }
      outputPath = path.resolve(candidate);
      index += 1;
      continue;
    }
    artifactRoots.push(path.resolve(value));
  }

  const defaultArtifactRoot = path.resolve(process.cwd(), "artifacts");
  const resolvedRoots = artifactRoots.length > 0 ? artifactRoots : [defaultArtifactRoot];
  return {
    artifactRoots: resolvedRoots,
    outputPath: outputPath ?? path.join(resolvedRoots[0], "artifact-quality-summary.json"),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const summary = await buildArtifactQualitySummary({
    artifactRoots: args.artifactRoots,
    outputPath: args.outputPath,
  });

  console.log(JSON.stringify({
    outputPath: args.outputPath,
    sampleCount: summary.sampleCount,
    diagnosisSamples: summary.consumers.diagnosisCoding?.sampleCount ?? 0,
    referralSamples: summary.consumers.referralProposal?.sampleCount ?? 0,
    printedNoteSamples: summary.consumers.printedNoteChartValues?.sampleCount ?? 0,
    recommendedThresholdActions: summary.recommendedThresholdActions,
    commonIssues: summary.commonIssues,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown artifact quality summary error.");
  process.exitCode = 1;
});
