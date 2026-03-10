/** Core types for WebMap */

export interface CrawlOptions {
  /** Target URL to crawl */
  url: string;
  /** Maximum crawl depth (default: 3) */
  maxDepth?: number;
  /** Maximum pages to crawl (default: 50) */
  maxPages?: number;
  /** Timeout per page in ms (default: 30000) */
  pageTimeout?: number;
}

export interface InteractiveElement {
  /** ARIA role (button, link, textbox, combobox, etc.) */
  role: string;
  /** Accessible name / label */
  name: string;
  /** Stable accessibility selector */
  selector: string;
  /** Element type description */
  type: string;
  /** What happens when you interact with it */
  action: string;
  /** Expected result of interaction */
  result: string;
  /** Current state (enabled, disabled, checked, expanded, etc.) */
  state?: string;
}

export interface FormField {
  /** Field label */
  label: string;
  /** Input type (text, email, password, select, etc.) */
  inputType: string;
  /** Accessibility selector */
  selector: string;
  /** Whether field is required */
  required: boolean;
  /** Validation rules if detectable */
  validation?: string;
  /** Placeholder text */
  placeholder?: string;
}

export interface PageForm {
  /** Form name/purpose */
  name: string;
  /** Submit button selector */
  submitSelector: string;
  /** Form fields */
  fields: FormField[];
  /** What happens on submit */
  submitAction: string;
}

export interface PageData {
  /** Page URL */
  url: string;
  /** Page title */
  title: string;
  /** Brief description of the page's purpose */
  purpose: string;
  /** How to reach this page from the homepage */
  howToReach: string;
  /** All interactive elements on the page */
  elements: InteractiveElement[];
  /** Forms on the page */
  forms: PageForm[];
  /** Dynamic behavior notes */
  dynamicBehavior: string[];
  /** Raw accessibility tree snapshot */
  accessibilitySnapshot?: string;
  /** Screenshot path (if captured) */
  screenshotPath?: string;
  /** Base64-encoded annotated screenshot with numbered element overlays (CUA mode) */
  annotatedScreenshot?: string;
  /** Visual layout description for vision-based agents (CUA mode) */
  visualLayout?: string;
  /** Navigation strategy hints for vision-based agents (CUA mode) */
  navigationStrategy?: string;
}

export interface WorkflowStep {
  /** Step number */
  step: number;
  /** Human-readable action description */
  description: string;
  /** Element selector to interact with */
  selector?: string;
  /** Action type (click, type, select, navigate, wait) */
  actionType: string;
  /** Value to input (for type/select actions) */
  value?: string;
  /** Expected page/state after this step */
  expectedResult: string;
}

export interface Workflow {
  /** Workflow name (e.g., "Purchase Flow", "Login Flow") */
  name: string;
  /** Brief description */
  description: string;
  /** Ordered steps */
  steps: WorkflowStep[];
}

export interface SiteMap {
  /** Root URL */
  rootUrl: string;
  /** Tree of pages */
  pages: SiteMapNode[];
}

export interface SiteMapNode {
  /** Page URL */
  url: string;
  /** Page title */
  title: string;
  /** Brief description */
  description: string;
  /** Whether this page requires authentication */
  requiresAuth: boolean;
  /** Child pages */
  children: SiteMapNode[];
}

export interface SiteDocumentation {
  /** Domain name */
  domain: string;
  /** Root URL that was crawled */
  rootUrl: string;
  /** Brief site description */
  description: string;
  /** When the crawl was performed */
  crawledAt: string;
  /** Site map tree */
  siteMap: SiteMap;
  /** Detailed page data */
  pages: PageData[];
  /** Detected workflows */
  workflows: Workflow[];
  /** Generation metadata */
  metadata: {
    totalPages: number;
    totalElements: number;
    totalWorkflows: number;
    crawlDurationMs: number;
    tokensUsed: number;
    /** Total LLM retry attempts across all calls */
    llmRetries: number;
    /** LLM calls that failed after all retries */
    llmFailures: number;
    /** Average validation confidence across enriched pages (0-1) */
    avgConfidence: number;
    /** Percentage of pages successfully enriched vs fallback (0-1) */
    enrichmentRate: number;
  };
}
