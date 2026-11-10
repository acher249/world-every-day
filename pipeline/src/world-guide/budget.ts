/** Admission reservations, not provider billing measurements. Amounts are USD cents. */
export function readWorldGuideBudget(environment: NodeJS.ProcessEnv = process.env) {
  const dailyCents = Number(environment.WORLD_GUIDE_DAILY_BUDGET_CENTS ?? 500);
  const sessionCents = Number(environment.WORLD_GUIDE_SESSION_RESERVATION_CENTS ?? 0);
  if (![dailyCents, sessionCents].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error("World Guide budget settings must be non-negative integer cents");
  }
  return { dailyCents, sessionCents, configured: sessionCents > 0 && dailyCents >= sessionCents };
}
