import "dotenv/config";
import { createRequire } from "node:module";
import mongoose from "mongoose";

const require = createRequire(import.meta.url);
const { seedKnowledge } = require("../src/modules/knowledge-rag/seed-knowledge.js");

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is required. Set it in backend/.env.");
  }
  if (!["development", "test"].includes(process.env.NODE_ENV)) {
    throw new Error("Set NODE_ENV to development or test before seeding.");
  }

  const apply = process.argv.includes("--apply");
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  try {
    const result = await seedKnowledge({
      db: mongoose.connection.db,
      environment: process.env.NODE_ENV,
      dryRun: !apply
    });
    console.log(JSON.stringify(result, null, 2));
    if (!apply) console.log("Preview only. Add --apply after verifying this is a non-production database.");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(`Knowledge seed failed: ${error.message}`);
  process.exitCode = 1;
});
