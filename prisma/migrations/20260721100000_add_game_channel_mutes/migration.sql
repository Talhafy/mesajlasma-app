-- This table existed in the Prisma schema but was missing from the historical
-- migration chain. It follows add_group_channels because it references GameChannel.
CREATE TABLE IF NOT EXISTS "GameChannelMute" (
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameChannelMute_pkey" PRIMARY KEY ("channelId", "userId")
);

CREATE INDEX IF NOT EXISTS "GameChannelMute_userId_idx" ON "GameChannelMute"("userId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GameChannelMute_channelId_fkey') THEN
    ALTER TABLE "GameChannelMute"
    ADD CONSTRAINT "GameChannelMute_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "GameChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GameChannelMute_userId_fkey') THEN
    ALTER TABLE "GameChannelMute"
    ADD CONSTRAINT "GameChannelMute_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
