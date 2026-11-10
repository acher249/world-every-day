import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const livekitRoot = path.join(frontendRoot, "node_modules/livekit-client");
const packagePath = path.join(livekitRoot, "package.json");
const bundlePath = path.join(livekitRoot, "dist/livekit-client.esm.mjs");
const livekitPackage = JSON.parse(await readFile(packagePath, "utf8"));

// Forward-port the upstream fix until a published livekit-client release includes it:
// https://github.com/livekit/client-sdk-js/commit/a2ef1bed38c7f0589cf7d228762a3fcda970405b
if (livekitPackage.version !== "2.23.0") {
  throw new Error(
    `The World Guide LiveKit close patch targets livekit-client 2.23.0; found ${livekitPackage.version}. Remove or update this patch when upgrading LiveKit.`,
  );
}

const bundle = await readFile(bundlePath, "utf8");
const originalReadLoop = `        } catch (e) {
          this.log.error("error reading from signal stream", {
            error: e
          });
          yield this.handleOnClose('error in reading loop', attemptId);
          break;
        }`;
const patchedReadLoop = `        } catch (e) {
          yield this.handleOnClose('error in reading loop', attemptId, undefined, e);
          break;
        }`;
const originalCloseParams = `      let simulateReconnectDelay = arguments.length > 2 ? arguments[2] : undefined;
      return function* () {`;
const patchedCloseParams = `      let simulateReconnectDelay = arguments.length > 2 ? arguments[2] : undefined;
      let readError = arguments.length > 3 ? arguments[3] : undefined;
      return function* () {`;
const originalIgnoredClose = `          _this6.log.debug("ignoring transport close in state ".concat(_this6.lifecycleState), {
            reason,
            attemptId,
            currentAttemptId: _this6.attemptId
          });
          return;
        }
        yield _this6.teardownTransport(reason);`;
const patchedIgnoredClose = `          const logContext = {
            reason,
            attemptId,
            currentAttemptId: _this6.attemptId
          };
          if (readError !== undefined) logContext.error = readError;
          _this6.log.debug("ignoring transport close in state ".concat(_this6.lifecycleState), logContext);
          return;
        }
        if (readError !== undefined) {
          _this6.log.error("error reading from signal stream", { error: readError });
        }
        yield _this6.teardownTransport(reason);`;

if (bundle.includes(patchedReadLoop) && bundle.includes(patchedIgnoredClose)) {
  process.stdout.write("LiveKit intentional-close handling is already patched.\n");
} else {
  const requiredReplacements = [
    [originalReadLoop, patchedReadLoop],
    [originalCloseParams, patchedCloseParams],
    [originalIgnoredClose, patchedIgnoredClose],
  ];

  let patchedBundle = bundle;
  for (const [before, after] of requiredReplacements) {
    const matches = patchedBundle.split(before).length - 1;
    if (matches !== 1) {
      throw new Error(
        `Could not safely apply the LiveKit intentional-close patch: expected one match, found ${matches}.`,
      );
    }
    patchedBundle = patchedBundle.replace(before, after);
  }

  await writeFile(bundlePath, patchedBundle);
  process.stdout.write("Applied LiveKit intentional-close handling patch.\n");
}
