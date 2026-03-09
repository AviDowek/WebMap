/**
 * @webmap/benchmark library exports.
 */

export {
  runBenchmark,
  printBenchmarkSummary,
  computeMetrics,
  formatDocsForCUA,
  type BenchmarkTask,
  type TaskResult,
  type BenchmarkResult,
} from "./runner.js";
export { sampleTasks } from "./tasks/sample-tasks.js";
export { generateTasksForSite, createManualTask } from "./task-generator.js";
