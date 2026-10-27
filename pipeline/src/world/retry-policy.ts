/** Only explicit terminal provider failures may authorize another paid submission. */
export const MAX_WORLD_ATTEMPTS = 4;

export function retryableWorldFailure(error: { code: string; message: string }): boolean {
  // Includes the legacy record produced before numeric provider codes were retained.
  return ["500", "502", "503", "504", "INTERNAL", "UNAVAILABLE", "DEADLINE_EXCEEDED"].includes(error.code) ||
    (error.code === "WORLD_LABS_GENERATION_FAILED" && error.message === "An error has happened, please retry it.");
}
