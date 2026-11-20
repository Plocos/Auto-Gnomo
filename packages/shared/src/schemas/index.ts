import { z } from 'zod';
import {
  AssistantDocumentKinds,
  AssistantProposalStatuses,
  AssistantProposalTypes,
  DeductionOrigins,
  ExpenseNatures,
  IrpfMethods,
  IvaRegimes,
  MovementSources,
  MovementStatuses,
  MovementTypes,
  Quarters,
  QuarterStatuses,
  TemporalCriteria,
  VatTreatments,
} from '../types.js';

export const moneyCentsSchema = z.number().int();
export const rateBpsSchema = z.number().int().min(0).max(100_000);
export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const vaultRenameSchema = z.object({
  name: z.string().min(1).max(120),
});

export const openVaultSchema = z.object({
  dataDir: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  /** true = crear subcarpeta de perfil; false/omitido = abrir existente (sin inventar vault). */
  create: z.boolean().optional(),
});

export const taxProfileSchema = z.object({
  fiscalYear: z.number().int().min(2000).max(2100),
  activityStartDate: dateOnlySchema,
  nif: z.string().min(8).max(12),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  /** Derivado en servidor como "APELLIDOS NOMBRE"; se ignora si se envía. */
  fullName: z.string().max(200).optional(),
  epigrafe: z.string().min(1).max(50),
  /** Clave de actividad del libro registro AEAT: A (IAE), B (no IAE), C (no iniciada), D (arrendador). */
  activityCode: z.enum(['A', 'B', 'C', 'D']).default('A'),
  /** Tipo de actividad AEAT 01–06 (A05 = actividad profesional); vacío para C y D. */
  activityType: z.string().regex(/^(\d{2})?$/).default('05'),
  ivaRegime: z.enum(IvaRegimes),
  irpfMethod: z.enum(IrpfMethods),
  temporalCriterion: z.enum(TemporalCriteria),
  address: z.string().optional(),
  notes: z.string().optional(),
});

export const movementCreateSchema = z.object({
  type: z.enum(MovementTypes),
  invoiceDate: dateOnlySchema,
  fiscalDate: dateOnlySchema,
  issueDate: dateOnlySchema.optional(),
  dueDate: dateOnlySchema.optional(),
  settlementDate: dateOnlySchema.optional(),
  invoiceNumber: z.string().max(100).optional(),
  partyName: z.string().max(200).optional(),
  partyNif: z.string().max(20).optional(),
  concept: z.string().min(1).max(500),
  categoryKey: z.string().max(80).optional(),
  subcategoryKey: z.string().max(80).optional(),
  taxBaseCents: moneyCentsSchema,
  vatRateBps: rateBpsSchema.default(0),
  vatCents: moneyCentsSchema.optional(),
  irpfRateBps: rateBpsSchema.default(0),
  irpfWithheldCents: moneyCentsSchema.optional(),
  totalCents: moneyCentsSchema.optional(),
  settledCents: moneyCentsSchema.optional(),
  professionalUseBps: rateBpsSchema.default(10_000),
  taxDeductibleBps: rateBpsSchema.default(10_000),
  expenseNature: z.enum(ExpenseNatures).default('current'),
  vatTreatment: z.enum(VatTreatments).optional(),
  status: z.enum(MovementStatuses).default('confirmed'),
  source: z.enum(MovementSources).default('manual'),
  notes: z.string().max(2000).optional(),
  professionalJustification: z.string().max(2000).optional(),
  correctsMovementId: z.string().optional(),
  correctionReason: z.string().max(1000).optional(),
  assetId: z.string().optional(),
  documentId: z.string().optional(),
  accrualStartDate: dateOnlySchema.optional(),
  accrualEndDate: dateOnlySchema.optional(),
  /** Solo alta de inmovilizado: coef. para generar el activo + plan (no se persiste en el movimiento). */
  coefficientBps: rateBpsSchema.optional(),
  /** Puesta en marcha del activo; por defecto = fiscalDate. */
  inServiceDate: dateOnlySchema.optional(),
});

export const movementUpdateSchema = movementCreateSchema.partial();

export const movementQuerySchema = z.object({
  fiscalYear: z.coerce.number().int().optional(),
  quarter: z.enum(Quarters).optional(),
  type: z.enum(MovementTypes).optional(),
  status: z.enum(MovementStatuses).optional(),
  search: z.string().optional(),
  categoryKey: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
  sortBy: z.string().default('fiscalDate'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export const quarterKeySchema = z.object({
  fiscalYear: z.number().int(),
  quarter: z.enum(Quarters),
});

export const TaxModels = ['130', '303'] as const;
export type TaxModel = (typeof TaxModels)[number];

export const fileQuarterSchema = z.object({
  fiscalYear: z.number().int(),
  quarter: z.enum(Quarters),
  filedAt: dateOnlySchema.optional(),
  observations: z.string().max(2000).optional(),
  amountPaidCents: moneyCentsSchema.optional(),
  models: z.array(z.enum(TaxModels)).default(['130', '303']),
  confirm: z.literal(true),
});

export const fileModelSchema = z.object({
  fiscalYear: z.number().int(),
  quarter: z.enum(Quarters),
  model: z.enum(TaxModels),
  filedAt: dateOnlySchema.optional(),
  confirm: z.literal(true),
});

export const reopenModelSchema = z.object({
  fiscalYear: z.number().int(),
  quarter: z.enum(Quarters),
  model: z.enum(TaxModels),
  reason: z.string().min(5).max(2000),
  confirm: z.literal(true),
});

export const reopenQuarterSchema = z.object({
  fiscalYear: z.number().int(),
  quarter: z.enum(Quarters),
  reason: z.string().min(5).max(2000),
  confirm: z.literal(true),
});

export const setQuarterStatusSchema = z.object({
  fiscalYear: z.number().int(),
  quarter: z.enum(Quarters),
  status: z.enum(QuarterStatuses),
});

export const assetCreateSchema = z.object({
  name: z.string().min(1).max(200),
  acquisitionDate: dateOnlySchema,
  inServiceDate: dateOnlySchema,
  taxBaseCents: moneyCentsSchema.positive(),
  coefficientBps: rateBpsSchema, // e.g. 2600 = 26%
  method: z.enum(['linear']).default('linear'),
  /** Obligatorio: el activo nace desde un movimiento de inmovilizado. */
  movementId: z.string().min(1),
  notes: z.string().max(2000).optional(),
});

export const pasteImportSchema = z.object({
  tsv: z.string().min(1),
  defaultType: z.enum(MovementTypes).default('expense'),
  dryRun: z.boolean().default(true),
});

export const assistantIssueSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  message: z.string(),
  field: z.string().optional(),
  code: z.string().optional(),
});

export const assistantProposalSchema = z.object({
  id: z.string(),
  status: z.enum(AssistantProposalStatuses),
  documentKind: z.enum(AssistantDocumentKinds),
  type: z.enum(AssistantProposalTypes),
  invoiceDate: z.string().optional(),
  fiscalDate: z.string().optional(),
  dueDate: z.string().optional(),
  settlementDate: z.string().optional(),
  invoiceNumber: z.string().optional(),
  partyName: z.string().optional(),
  partyNif: z.string().optional(),
  concept: z.string().optional(),
  categoryKey: z.string().optional(),
  taxBaseCents: z.number().int().optional(),
  vatRateBps: z.number().int().optional(),
  vatCents: z.number().int().optional(),
  irpfRateBps: z.number().int().optional(),
  irpfWithheldCents: z.number().int().optional(),
  totalCents: z.number().int().optional(),
  documentTotalCents: z.number().int().optional(),
  totalMismatch: z.boolean().optional(),
  professionalUseBps: z.number().int().optional(),
  taxDeductibleBps: z.number().int().optional(),
  deductionOrigin: z.enum(DeductionOrigins).optional(),
  expenseNature: z.enum(ExpenseNatures).optional(),
  vatTreatment: z.enum(VatTreatments).optional(),
  coefficientBps: z.number().int().optional(),
  inServiceDate: z.string().optional(),
  notes: z.string().optional(),
  evidence: z.string().optional(),
  confidence: z.record(z.number()).optional(),
  missingFields: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
  issues: z.array(assistantIssueSchema).optional(),
  fileId: z.string().optional(),
  movementId: z.string().optional(),
  pagesTruncated: z.boolean().optional(),
});

const optionalDate = z.union([dateOnlySchema, z.literal('')]).optional();

export const assistantAcceptSchema = z.object({
  documentKind: z.enum(AssistantDocumentKinds),
  type: z.enum(AssistantProposalTypes),
  invoiceDate: dateOnlySchema,
  fiscalDate: dateOnlySchema,
  dueDate: optionalDate,
  settlementDate: optionalDate,
  invoiceNumber: z.string().max(100).optional(),
  partyName: z.string().max(200).optional(),
  partyNif: z.string().max(20).optional(),
  concept: z.string().min(1).max(500),
  categoryKey: z.string().max(80).optional(),
  taxBaseCents: moneyCentsSchema,
  vatRateBps: rateBpsSchema,
  irpfRateBps: rateBpsSchema.default(0),
  professionalUseBps: rateBpsSchema.default(10_000),
  taxDeductibleBps: rateBpsSchema.default(10_000),
  expenseNature: z.enum(ExpenseNatures).default('current'),
  vatTreatment: z.union([z.enum(VatTreatments), z.literal('')]).optional(),
  coefficientBps: rateBpsSchema.optional(),
  inServiceDate: optionalDate,
  notes: z.string().max(2000).optional(),
});

export const assistantFileSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mime: z.string(),
  relativePath: z.string(),
  pageCount: z.number().int().optional(),
  truncated: z.boolean().optional(),
});

export const assistantMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  files: z.array(assistantFileSchema),
  proposals: z.array(assistantProposalSchema),
  summary: z.string().optional(),
  warnings: z.array(z.string()),
  replyToId: z.string().optional(),
  createdAt: z.string(),
});

export const assistantProgressSchema = z.object({
  label: z.string(),
  received: z.number(),
  total: z.number().nullable(),
  percent: z.number().nullable(),
  fileIndex: z.number(),
  fileCount: z.number(),
});

export const assistantStatusSchema = z.object({
  installed: z.boolean(),
  downloading: z.boolean(),
  ready: z.boolean(),
  loading: z.boolean(),
  bytesOnDisk: z.number(),
  dir: z.string(),
  progress: assistantProgressSchema.nullable(),
  error: z.string().nullable(),
  modelLabel: z.string(),
});

export type TaxProfileInput = z.infer<typeof taxProfileSchema>;
/** Input de creación (campos con .default() opcionales en la llamada). */
export type MovementCreateInput = z.input<typeof movementCreateSchema>;
export type MovementUpdateInput = z.input<typeof movementUpdateSchema>;
export type MovementQuery = z.infer<typeof movementQuerySchema>;
export type FileQuarterInput = z.infer<typeof fileQuarterSchema>;
export type FileModelInput = z.infer<typeof fileModelSchema>;
export type ReopenModelInput = z.infer<typeof reopenModelSchema>;
export type AssetCreateInput = z.infer<typeof assetCreateSchema>;
export type AssistantProposal = z.infer<typeof assistantProposalSchema>;
export type AssistantAcceptInput = z.input<typeof assistantAcceptSchema>;
export type AssistantFile = z.infer<typeof assistantFileSchema>;
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;
export type AssistantStatus = z.infer<typeof assistantStatusSchema>;
export type AssistantProgress = z.infer<typeof assistantProgressSchema>;
