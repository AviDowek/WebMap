/**
 * @webmap/benchmark library exports.
 */

export {
  runBenchmark,
  runMultiMethodBenchmark,
  printBenchmarkSummary,
  computeMetrics,
  formatDocsForCUA,
  formatCompactCUAGuide,
  formatFullGuide,
  formatMicroGuide,
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
  type AggregateMetrics,
} from "./runner.js";
export { sampleTasks } from "./tasks/sample-tasks.js";
export {
  generateTasksForSite,
  generateDiverseSites,
  createManualTask,
} from "./task-generator.js";
