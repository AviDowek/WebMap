/**
 * @webmap/benchmark library exports.
 */

// Types and constants
export {
  ALL_DOC_METHODS,
  DOC_METHOD_LABELS,
  type BenchmarkTask,
  type TaskResult,
  type BenchmarkResult,
  type DocMethod,
  type MethodResult,
  type SiteResult,
  type MultiMethodBenchmarkResult,
  type MultiMethodBenchmarkOptions,
  type MultiRunTaskResult,
  type AggregateMetrics,
} from "./types.js";

// Metrics
export {
  computeMetrics,
  printBenchmarkSummary,
  aggregateRuns,
  wilsonConfidenceInterval,
} from "./metrics.js";

// Verification
export { verifyTaskSuccess, type VerificationResult } from "./cua/verification.js";

// Formatters
export {
  formatDocsForCUA,
  formatMicroGuide,
  formatCompactCUAGuide,
  formatFullGuide,
  formatFirstMessageDocs,
  generatePrePlan,
} from "./formatters/index.js";

// Runners
export { runBenchmark, runMultiMethodBenchmark } from "./runner.js";

// Tasks
export { sampleTasks } from "./tasks/sample-tasks.js";
export { SUITE_SITES, SUITE_TASKS, type BenchmarkSite } from "./tasks/suite-tasks.js";
export { generateMultiMethodReport, printMultiMethodSummary } from "./multi-report.js";
export {
  generateTasksForSite,
  generateDiverseSites,
  createManualTask,
} from "./task-generator.js";
