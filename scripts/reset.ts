import fs from "node:fs";
import path from "node:path";

const dataDir = process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), ".data", "pg");
if (fs.existsSync(dataDir)) {
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log(`[reset] removed ${dataDir}. Run npm run db:seed (or start the app) to rebuild.`);
} else {
  console.log("[reset] nothing to remove");
}
