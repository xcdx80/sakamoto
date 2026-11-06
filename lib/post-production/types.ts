/** Public, client-safe contracts for the Write journey. Sources remain library items. */
export type PostPlatform = "x" | "linkedin";
export type PostGoal = "trust" | "reach" | "convert";
export type PostDelivery = "single" | "thread" | "long";
export type ContentPillar = "engineering" | "transformation" | "education" | "other";

export type BrandProfile = {
  version: number;
  positioning: string;
  audience: string;
  pillars: string[];
  voice: string;
  preferredMoves: string[];
  bannedMoves: string[];
  ending: string;
  language: "English";
  defaultGoal: PostGoal;
  weeklyIdeas: number;
  examples: string[];
};

export type ProductionBrief = {
  idea: string;
  notes: string;
  audience: string;
  goal: PostGoal;
  pillar: ContentPillar;
  platforms: PostPlatform[];
  delivery: PostDelivery;
  sourceIds: string[];
};

export type ProductionEvidence = {
  id: string;
  itemId: string;
  sourceRevision: number;
  title: string;
  author?: string;
  excerpt: string;
  originalUrl?: string;
  readUrl?: string;
  address?: Record<string, unknown>;
  publishedAt?: string;
  kind: "saved_source" | "author_note" | "author_idea" | "web_source";
  retrievedAt?: string;
};

export type EvidenceSignal = {
  signal: string;
  strength: 0 | 1 | 2;
  evidenceIds: string[];
  probability?: number;
  decision?: "jev" | "sol_resolved_uncertainty" | "evidence_rule_rejection";
  rejection?: { proposedStrength: 1 | 2; evidenceIds: string[]; reason: string };
  assessment?: { model: "jev-latest"; score: number; probabilities: Record<string, number>; evidenceChoice: string | null };
  rationale?: string;
  support?: { evidenceId: string; quote: string; reason: string }[];
};

/** Explicit author assessment; omitted signals remain unknown. */
export type AuthorSignalAssessment = {
  signal: string;
  strength: 0 | 1 | 2;
  evidenceIds: string[];
  rationale: string;
};

export type FrameworkRecommendation = {
  frameworkId: string;
  name: string;
  family: string;
  score: number;
  reasons: string[];
  outline: string[];
  hookPatternIds: string[];
  warnings: string[];
};

export type DraftVariant = {
  platform: PostPlatform;
  delivery: PostDelivery;
  posts: string[];
};
export type DraftContent = {
  variants: DraftVariant[];
  hooks: string[];
  claimSources: { claim: string; evidenceIds: string[] }[];
};

export type ReviewIssue = {
  code: string;
  severity: "block" | "revise" | "suggestion";
  message: string;
  platform?: PostPlatform;
  postIndex?: number;
  evidenceIds?: string[];
};
export type CriterionScore = {
  id: string; score: number; reason: string; confidence?: number;
  evidenceIds?: string[];
  support?: { claim: string; evidenceId: string; quote: string; reason: string; claimKind?: "fact" | "interpretation" }[];
  draftSupport?: { platform: PostPlatform; postIndex: number; quote: string; reason: string }[];
  reviewer?: string;
  decision?: "jev_failure" | "reviewer_judgment" | "reviewer_resolved_uncertainty";
  assessment?: { model: "jev-latest"; outcome: "pass" | "fail" | "uncertain"; score: number; passProbability: number };
};
export type PlatformFactualAssessment = {
  platform: PostPlatform;
  hasFactualClaims: boolean;
  rationale: string;
  factualClaims: { postIndex: number; claim: string }[];
};
export type NonfactualSupport = {
  /** null addresses an alternate hook; postIndex then selects its hook index. */
  platform: PostPlatform | null;
  postIndex: number;
  quote: string;
  kind: "proposal" | "label" | "draft_structure";
  reason: string;
};
export type DraftReview = {
  status: "passed" | "changes_requested" | "blocked";
  issues: ReviewIssue[];
  criteria: CriterionScore[];
  writerModel: string;
  reviewerModel: string;
  factualAssessment?: PlatformFactualAssessment[];
  nonfactualSupport?: NonfactualSupport[];
  sharedScore?: number;
  frameworkScore?: number;
  totalScore?: number;
};
export type DraftRevision = {
  id: string;
  productionId: string;
  number: number;
  content: DraftContent;
  createdAt: string;
  origin: "writer" | "author" | "revision";
};
export type ProductionStatus = "draft" | "working" | "needs_input" | "paused" | "review" | "ready" | "approved" | "planned" | "published" | "cancelled";
export type ProductionStage = "context" | "selection" | "writing" | "review" | "revision" | "complete";
export type ProductionCheckpoint = {
  profile?: BrandProfile;
  catalogVersion?: string;
  evidence?: ProductionEvidence[];
  signals?: EvidenceSignal[];
  authorSignalAssessments?: AuthorSignalAssessment[];
  recommendations?: FrameworkRecommendation[];
  frameworkId?: string | null;
  hookPatternId?: string | null;
  revisionRounds?: number;
  reviewOnlyRevisionId?: string | null;
  writerModel?: string;
  reviewerModel?: string;
  promptVersion?: string;
  reviewPin?: {
    revisionId: string;
    profileVersion: number;
    catalogVersion: string;
    evidenceHash: string;
    contentHash: string;
    writerModel: string;
    reviewerModel: string;
    promptVersion: string;
    reviewPromptVersion?: string;
  } | null;
  authorRequest?: { instruction: string; baseRevisionId: string } | null;
  editorialDecision?: {
    framework: EditorialDecision;
    hook: EditorialDecision | null;
  };
  research?: { library: "searched"; web: "searched" | "unconfigured"; notice: string | null };
  publication?: {
    status: "submitting" | "submitted" | "uncertain";
    revisionId: string;
    attemptId: string;
    posts?: { platform: PostPlatform; postId: string; integrationId: string }[];
  } | null;
};
export type EditorialDecision = {
  selectedId: string;
  mode: "jev" | "editorial_tiebreak" | "sol_resolved_uncertainty";
  model: string;
  probabilities: Record<string, number>;
  supportProbability: number;
  reason: string;
  support?: { evidenceId: string; quote: string; reason: string }[];
};
export type Production = {
  id: string;
  brief: ProductionBrief;
  status: ProductionStatus;
  stage: ProductionStage;
  version: number;
  checkpoint: ProductionCheckpoint;
  latestRevisionId: string | null;
  approvedRevisionId: string | null;
  plannedAt: string | null;
  notice: string | null;
  createdAt: string;
  updatedAt: string;
};
export type ProductionDetail = {
  production: Production;
  revisions: DraftRevision[];
  review: (DraftReview & { revisionId: string }) | null;
  feedback?: { id: string; text: string; suggestedProfileUpdate: Partial<BrandProfile> | null; createdAt: string }[];
};
export type ProductionHistory = {
  id: string;
  idea: string;
  pillar: ContentPillar;
  frameworkId?: string;
  family?: string;
  hookPatternId?: string;
  platforms: PostPlatform[];
  status: ProductionStatus;
  plannedAt: string | null;
  createdAt: string;
};

export type WriteCatalogSummary = {
  version: string;
  frameworks: { id: string; name: string; form: string; family: string; summary: string; outline: string[]; hookPatternIds: string[] }[];
  hooks: { id: string; name: string; template: string; description: string; pitfalls: string[] }[];
  signals: { id: string; description: string }[];
};
export type WriteWorkspace = {
  profile: BrandProfile;
  productions: Production[];
  history: ProductionHistory[];
  catalog: WriteCatalogSummary;
  sources: { id: string; title: string }[];
  providers: { ready: boolean; writerModel: string; reviewerModel: string | null; notice: string | null; promptVersion: string };
  publishing?: { provider: "postiz"; ready: boolean; platforms: PostPlatform[]; notice: string | null };
};
export type WeeklyIdea = { brief: ProductionBrief; reason: string; warnings: string[] };
