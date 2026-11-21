ALTER TABLE "UserDevice"
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvedByDeviceId" TEXT,
  ADD COLUMN "approvalSignature" TEXT;

-- Preserve one existing device per account as the initial trust root.
WITH roots AS (
  SELECT DISTINCT ON ("userId") id, "createdAt"
  FROM "UserDevice" ORDER BY "userId", "createdAt", id
)
UPDATE "UserDevice" d SET "approvedAt" = roots."createdAt"
FROM roots WHERE d.id = roots.id;

CREATE UNIQUE INDEX "UserDevice_one_trust_root_per_user"
  ON "UserDevice" ("userId")
  WHERE "approvedAt" IS NOT NULL AND "approvedByDeviceId" IS NULL;


-- This guard also covers a worker left running during a rolling deployment.
CREATE FUNCTION validate_mls_message_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_epoch integer;
  group_roster jsonb;
  roster_device record;
BEGIN
  IF TG_OP = 'INSERT' AND NEW."clientId" LIKE 'scheduled:%' THEN
    RAISE EXCEPTION 'Scheduled message delivery is disabled' USING ERRCODE = '23514';
  END IF;
  IF NEW."isDeletedForEveryone" OR NEW."messageType" = 'system' THEN
    RETURN NEW;
  END IF;

  SELECT "mlsCurrentEpoch" INTO current_epoch FROM "Conversation"
    WHERE id = NEW."conversationId" AND NOT "isDeleted" FOR SHARE;
  IF NEW."protocolVersion" <> 1 THEN
    IF current_epoch > 0 THEN
      RAISE EXCEPTION 'MLS conversation requires encrypted messages' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.ciphertext IS NULL THEN
    RAISE EXCEPTION 'MLS ciphertext is required' USING ERRCODE = '23514';
  END IF;
  IF current_epoch IS NULL OR current_epoch < 1 OR NEW.epoch IS DISTINCT FROM current_epoch THEN
    RAISE EXCEPTION 'MLS epoch is not current' USING ERRCODE = '23514';
  END IF;
  SELECT "ratchetTree"::jsonb INTO group_roster FROM "MlsCommit"
    WHERE "conversationId" = NEW."conversationId" AND epoch = current_epoch;
  IF group_roster IS NULL OR NOT EXISTS (
    SELECT FROM jsonb_to_recordset(group_roster) AS leaf("deviceId" text, "userId" text)
    WHERE leaf."deviceId" = NEW."senderDeviceId" AND leaf."userId" = NEW."senderId"
  ) THEN
    RAISE EXCEPTION 'MLS sender is outside the group' USING ERRCODE = '23514';
  END IF;
  FOR roster_device IN
    SELECT "deviceId", "userId", "signaturePublicKeyBase64"
    FROM jsonb_to_recordset(group_roster) AS leaf("deviceId" text, "userId" text, "signaturePublicKeyBase64" text)
    ORDER BY "deviceId"
  LOOP
    PERFORM 1 FROM "UserDevice" WHERE id = roster_device."deviceId"
      AND "userId" = roster_device."userId"
      AND "signaturePublicKey" = roster_device."signaturePublicKeyBase64"
      AND "approvedAt" IS NOT NULL AND "revokedAt" IS NULL FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'MLS device removal requires a new epoch' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM "Participant" WHERE "conversationId" = NEW."conversationId"
      AND "userId" = roster_device."userId" AND "isActive" FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'MLS membership change requires a new epoch' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Message_mls_delivery_guard"
BEFORE INSERT OR UPDATE OF content, "ciphertext", "epoch", "senderDeviceId", "protocolVersion" ON "Message"
FOR EACH ROW EXECUTE FUNCTION validate_mls_message_delivery();
