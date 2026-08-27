export interface PaginatedResponse<T> {
  items: T[];
  nextCursor?: string | null;
}

/**
 * API endpoints that were migrated to cursor pagination return `{ items, nextCursor }`,
 * while a few older endpoints still return a plain array. Keep consumers safe during
 * that transition and never put a response envelope into array-backed React state.
 */
export const unwrapItems = <T>(payload: T[] | PaginatedResponse<T> | null | undefined): T[] => {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.items) ? payload.items : [];
};
