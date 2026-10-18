/** Fetch observations are separate from the immutable text of an individual post. */
export type ThreadCoverage = { status: 'exhausted' | 'partial'; observedAt: string; missingPostIds: string[] };
export function threadCoverageOf(raw: unknown): ThreadCoverage | undefined {
 if (raw === undefined) return undefined;
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid thread coverage.');
 const value=raw as Record<string,unknown>;
 if(Object.keys(value).some(key=>!['status','observedAt','missingPostIds'].includes(key)) || !['exhausted','partial'].includes(String(value.status)) || typeof value.observedAt!=='string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value.observedAt) || !Number.isFinite(Date.parse(value.observedAt)) || !Array.isArray(value.missingPostIds) || value.missingPostIds.length>1000 || value.missingPostIds.some(id=>typeof id!=='string'||!/^[1-9]\d{0,23}$/.test(id)) || (value.status==='exhausted'&&value.missingPostIds.length)) throw new Error('Invalid thread coverage.');
 return {status:value.status as ThreadCoverage['status'],observedAt:new Date(value.observedAt).toISOString(),missingPostIds:[...new Set(value.missingPostIds as string[])]};
}
