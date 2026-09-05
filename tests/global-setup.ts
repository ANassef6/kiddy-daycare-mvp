import fs from "fs";

const envUrl = process.env.KIDDY_DATABASE_URL ?? "";
const dbPath = envUrl.replace(/^file:/, "");

export default function globalSetup() {
  if (dbPath && !dbPath.startsWith(":")) {
    try {
      fs.rmSync(dbPath, { force: true });
    } catch {
      // ignore — fresh file will be created by better-sqlite3
    }
  }
}