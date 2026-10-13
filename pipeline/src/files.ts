import { access } from "node:fs/promises";
import { constants } from "node:fs";

export async function assertPathDoesNotExist(path: string, label = "Output"): Promise<void> {
  try {
    await access(path, constants.F_OK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${label} already exists: ${path}`);
}
