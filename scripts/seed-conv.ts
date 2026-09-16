// Seed historical conversations (equivalent of sql/seed.sql) for the mining job.
import { closeDb, prisma } from "@/db/client.ts";

async function main(): Promise<void> {
  const seedConversations = await prisma.conversation.findMany({
    where: { userId: { startsWith: "seed-" } },
    select: { id: true },
  });
  const ids = seedConversations.map((c) => c.id);
  if (ids.length > 0) {
    await prisma.message.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  }

  const c1 = await prisma.conversation.create({
    data: { userId: "seed-u1", status: "closed" },
  });
  const c2 = await prisma.conversation.create({
    data: { userId: "seed-u2", status: "closed" },
  });
  await prisma.message.createMany({
    data: [
      { conversationId: c1.id, role: "user", content: "How long does dispatch usually take?" },
      {
        conversationId: c1.id,
        role: "assistant",
        content: "In-stock items are dispatched within 48 hours of payment; pre-order items follow the dispatch time indicated on the product detail page.",
      },
      { conversationId: c2.id, role: "user", content: "How much do I need to spend for free shipping?" },
      {
        conversationId: c2.id,
        role: "assistant",
        content: "Orders of 99 yuan or more ship free; below that, a 10-yuan shipping fee is charged; shipping to remote areas is calculated separately.",
      },
    ],
  });
  console.log("✅ Historical conversation seeds inserted: seed-u1 / seed-u2, 2 conversations and 4 messages in total");
}

await main();
await closeDb();
