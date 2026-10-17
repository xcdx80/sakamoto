export function applyMigrations(sql: { query: (text: string, params?: unknown[]) => unknown; transaction: (queries: any[]) => Promise<unknown> }): Promise<void>;
