// Reset source knowledge while preserving human-approved flywheel answers.
import { closeDb, prisma } from "#/db/client.ts";
import * as repository from "#/db/repository.ts";
import * as documents from "#/kb/documents.ts";
import * as dualwrite from "#/kb/dualwrite.ts";
import * as store from "#/kb/store.ts";

const approvedReviews = await repository.listReviewQueue("approved");
const approvedStaging = await repository.listStagingByStatus("approved");
const preserved = [
  ...approvedReviews.flatMap((item) =>
    item.approvedAnswer
      ? [
          documents.approvedReviewChunk(
            item.normalizedQuestion,
            item.approvedAnswer,
          ),
        ]
      : [],
  ),
  ...approvedStaging.map((item) =>
    documents.approvedStagingChunk(item.question, item.answer),
  ),
];

await store.drop();
await prisma.knowledgeChunk.deleteMany();
await prisma.qaExtractionStaging.deleteMany({
  where: { status: { not: "approved" } },
});
await dualwrite.writePending(preserved);
console.log(
  `✅ KB reset; preserved ${preserved.length} approved answers as pending chunks. Re-run: kb-build && kb-vectorize`,
);
await closeDb();
