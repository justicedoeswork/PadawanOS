/**
 * Justice Exteriors' service taxonomy, as the Marketing Agent defines it
 * (`src/domain/service/service-trade.ts` there).
 *
 * Re-declared rather than imported: the two services are separate
 * deployables in separate repositories with no shared package, and the same
 * deliberate duplication already exists for the ACP session-token format
 * (see `gateway/src/session.ts`). What keeps the copy honest is that
 * JusticeOS never invents a trade — it only ever narrows to one of these,
 * and the Marketing Agent rejects anything it does not recognize, so a drift
 * surfaces as a clear `INVALID_REQUEST` from the owner of the taxonomy
 * rather than as a silently wrong answer here.
 */
export const SERVICE_TRADES = [
  'ROOFING',
  'SIDING',
  'GUTTERS',
  'SOFFIT_FASCIA',
  'EXTERIOR_REPAIR',
  'GENERAL_EXTERIOR',
  'OTHER'
] as const;

export type ServiceTrade = (typeof SERVICE_TRADES)[number];
