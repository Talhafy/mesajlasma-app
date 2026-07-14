-- CreateEnum
CREATE TYPE "GameChannelType" AS ENUM ('TEXT', 'VOICE');

-- CreateTable
CREATE TABLE "GameChannel" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GameChannelType" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "maxParticipants" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameChannel_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "gameChannelId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "GameChannel_conversationId_type_name_key" ON "GameChannel"("conversationId", "type", "name");
CREATE INDEX "GameChannel_conversationId_type_position_idx" ON "GameChannel"("conversationId", "type", "position");
CREATE INDEX "GameChannel_createdById_idx" ON "GameChannel"("createdById");
CREATE INDEX "Message_gameChannelId_createdAt_id_idx" ON "Message"("gameChannelId", "createdAt" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "GameChannel" ADD CONSTRAINT "GameChannel_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_gameChannelId_fkey" FOREIGN KEY ("gameChannelId") REFERENCES "GameChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
