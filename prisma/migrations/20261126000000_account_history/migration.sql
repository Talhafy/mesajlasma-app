CREATE TABLE "AccountHistoryKey" (
    "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "salt" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "inboxIv" TEXT NOT NULL,
    "inboxKey" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE "AccountHistoryMessage" (
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "messageId" TEXT NOT NULL REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "version" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    PRIMARY KEY ("userId", "messageId", "version")
);

CREATE INDEX "AccountHistoryMessage_messageId_idx" ON "AccountHistoryMessage"("messageId");

ALTER TABLE "Message" ADD COLUMN "historyDelivery" JSONB;
