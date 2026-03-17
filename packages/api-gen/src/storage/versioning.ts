/**
 * Schema versioning for DomainAPI cache.
 * Handles migration when the schema evolves.
 */

import type { DomainAPI } from "../types.js";
import { SCHEMA_VERSION } from "../types.js";

/**
 * Check if a DomainAPI needs migration and apply it.
 * Returns the migrated DomainAPI or the original if no migration needed.
 */
export function migrateIfNeeded(api: DomainAPI): DomainAPI {
  let current = api;

  // Future migrations go here:
  // if (current.schemaVersion < 2) current = migrate_v1_to_v2(current);
  // if (current.schemaVersion < 3) current = migrate_v2_to_v3(current);

  if (current.schemaVersion < SCHEMA_VERSION) {
    // If we reach here, there's a version gap with no migration path
    // This shouldn't happen in practice, but handle gracefully
    current = { ...current, schemaVersion: SCHEMA_VERSION };
  }

  return current;
}

/**
 * Check if a DomainAPI is at the current schema version.
 */
export function isCurrentVersion(api: DomainAPI): boolean {
  return api.schemaVersion === SCHEMA_VERSION;
}
