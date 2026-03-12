/**
 * Types for industry CUA benchmark dataset integration.
 */

export type DatasetSource =
  | "custom"
  | "mind2web"
  | "webbench"
  | "webarena"
  | "webchore-arena"
  | "visual-webarena"
  | "workarena";

export interface DatasetInfo {
  id: DatasetSource;
  name: string;
  description: string;
  /** Total number of tasks in the full dataset (may require Docker/SaaS to access all) */
  taskCount: number;
  /**
   * Number of tasks bundled in this package (ready to use without Docker setup).
   * Only set for Docker-based datasets where the full set requires local deployment.
   * If absent, all taskCount tasks are available.
   */
  bundledTaskCount?: number;
  /** Estimated average tokens per task (for cost estimation) */
  avgTokensPerTask: number;
  /** Whether a local Docker environment must be running */
  requiresDocker: boolean;
  /** Whether external SaaS credentials are needed */
  requiresCredentials: boolean;
  /** HuggingFace dataset ID (for downloadable datasets) */
  hfDataset?: string;
  /** GitHub repo for Docker setup instructions */
  dockerRepo?: string;
  /** Default base URL for self-hosted datasets */
  defaultBaseUrl?: string;
}

export interface DatasetConfig {
  source: DatasetSource;
  /** Limit to first N tasks (default: all) */
  subset?: number;
  /** Filter tasks by category/domain strings (substring match) */
  categories?: string[];
  /**
   * Base URL for self-hosted datasets (e.g. "http://localhost:7770").
   * Required for webarena, webchore-arena, visual-webarena.
   */
  dockerBaseUrl?: string;
  /** Credentials for external SaaS datasets (workarena) */
  credentials?: Record<string, string>;
}

export interface CostEstimate {
  /** Total estimated USD cost */
  total: number;
  /** Per-method breakdown */
  perMethod: Record<string, number>;
  /** Number of tasks used for the estimate */
  taskCount: number;
  /** Cost without caching */
  uncachedTotal: number;
}
