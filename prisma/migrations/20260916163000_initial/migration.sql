-- CreateTable
CREATE TABLE "Conversation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "summary" TEXT,
    "summaryUptoMsgId" INTEGER,
    "layer1FromMsgId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ConversationSummary" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "conversationId" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "fromMsgId" INTEGER NOT NULL,
    "uptoMsgId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Message" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "conversationId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT,
    "toolCalls" TEXT,
    "toolCallId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Faq" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Ticket" (
    "ticketNo" TEXT NOT NULL PRIMARY KEY,
    "conversationId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "ticketType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Ticket_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "category" TEXT NOT NULL,
    "questions" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sectionPath" TEXT,
    "contentType" TEXT,
    "isKeyClause" INTEGER NOT NULL DEFAULT 0,
    "prevChunkId" INTEGER,
    "nextChunkId" INTEGER,
    "vectorId" TEXT,
    "vectorizeStatus" TEXT NOT NULL DEFAULT 'pending',
    "embedding" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "QaExtractionStaging" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "batchNo" TEXT NOT NULL,
    "sourceRef" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'extracted',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ToolAuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "conversationId" INTEGER,
    "toolCallId" TEXT,
    "toolName" TEXT NOT NULL,
    "toolSource" TEXT NOT NULL,
    "mcpServer" TEXT,
    "arguments" TEXT,
    "resultSummary" TEXT,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LowConfidenceQuestion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "conversationId" INTEGER,
    "rawQuestion" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT,
    "retrievedChunks" TEXT,
    "matchedReviewId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LowConfidenceQuestion_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LowConfidenceQuestion_matchedReviewId_fkey" FOREIGN KEY ("matchedReviewId") REFERENCES "ReviewQueue" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewQueue" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "normalizedQuestion" TEXT NOT NULL,
    "aiSuggestedAnswer" TEXT,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending_review',
    "approvedAnswer" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EvalRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "triggeredBy" TEXT NOT NULL DEFAULT 'scheduled',
    "datasetSize" INTEGER NOT NULL,
    "metrics" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "FaithCase" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "evalId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'hybrid_rerank',
    "answer" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "citations" TEXT,
    "judgeModel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unresolved',
    "seenCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolution" TEXT,
    "resolvedAt" DATETIME
);

-- CreateTable
CREATE TABLE "TopicClassification" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "questionId" INTEGER NOT NULL,
    "labels" TEXT NOT NULL,
    "classifiedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TopicClassification_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "LowConfidenceQuestion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Conversation_userId_idx" ON "Conversation"("userId");

-- CreateIndex
CREATE INDEX "ConversationSummary_conversationId_uptoMsgId_idx" ON "ConversationSummary"("conversationId", "uptoMsgId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationSummary_conversationId_seq_key" ON "ConversationSummary"("conversationId", "seq");

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE INDEX "Faq_category_idx" ON "Faq"("category");

-- CreateIndex
CREATE INDEX "Ticket_conversationId_idx" ON "Ticket"("conversationId");

-- CreateIndex
CREATE INDEX "LowConfidenceQuestion_conversationId_idx" ON "LowConfidenceQuestion"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "FaithCase_evalId_key" ON "FaithCase"("evalId");

-- CreateIndex
CREATE UNIQUE INDEX "TopicClassification_questionId_key" ON "TopicClassification"("questionId");
