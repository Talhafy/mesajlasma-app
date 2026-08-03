-- Cursor-based read state prevents one MessageRead row per user/message in large groups.
CREATE TABLE "ConversationReadState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "channelKey" TEXT NOT NULL DEFAULT '',
    "lastReadAt" TIMESTAMP(3) NOT NULL,
    "lastReadMessageId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConversationReadState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConversationReadState_userId_conversationId_channelKey_key"
ON "ConversationReadState"("userId", "conversationId", "channelKey");
CREATE INDEX "ConversationReadState_conversationId_channelKey_lastReadAt_idx"
ON "ConversationReadState"("conversationId", "channelKey", "lastReadAt");

ALTER TABLE "ConversationReadState"
ADD CONSTRAINT "ConversationReadState_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationReadState"
ADD CONSTRAINT "ConversationReadState_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve existing read receipts as a single cursor per user/conversation/channel before
-- the application switches to cursor writes. New reads no longer grow MessageRead linearly.
INSERT INTO "ConversationReadState"
  ("id", "userId", "conversationId", "channelKey", "lastReadAt", "updatedAt")
SELECT
  'legacy-read:' || mr."userId" || ':' || m."conversationId" || ':' || COALESCE(m."gameChannelId", ''),
  mr."userId",
  m."conversationId",
  COALESCE(m."gameChannelId", ''),
  MAX(m."createdAt"),
  CURRENT_TIMESTAMP
FROM "MessageRead" mr
INNER JOIN "Message" m ON m."id" = mr."messageId"
GROUP BY mr."userId", m."conversationId", m."gameChannelId"
ON CONFLICT ("userId", "conversationId", "channelKey") DO UPDATE
SET "lastReadAt" = GREATEST("ConversationReadState"."lastReadAt", EXCLUDED."lastReadAt"),
    "updatedAt" = CURRENT_TIMESTAMP;

-- pg_trgm supports indexed substring search (ILIKE '%term%') without a full table scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Message_content_trgm_idx" ON "Message" USING GIN ("content" gin_trgm_ops);
