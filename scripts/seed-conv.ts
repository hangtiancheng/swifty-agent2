// Seed historical conversations (equivalent of sql/ch03-seed.sql) for the mining job.
import { closeDb, prisma } from "../src/db/client.ts";

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

  const c1 = await prisma.conversation.create({ data: { userId: "seed-u1", status: "已结束" } });
  const c2 = await prisma.conversation.create({ data: { userId: "seed-u2", status: "已结束" } });
  await prisma.message.createMany({
    data: [
      { conversationId: c1.id, role: "user", content: "你们发货一般多久啊" },
      { conversationId: c1.id, role: "assistant", content: "现货商品付款后 48 小时内发货,预售以商品详情页标注时间为准。" },
      { conversationId: c2.id, role: "user", content: "满多少包邮" },
      { conversationId: c2.id, role: "assistant", content: "单笔订单满 99 元包邮,未满收取 10 元运费,偏远地区另计。" },
    ],
  });
  console.log("✅ 已灌历史会话种子:seed-u1 / seed-u2 共 2 会话、4 消息");
}

await main();
await closeDb();
