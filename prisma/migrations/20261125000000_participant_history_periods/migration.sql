CREATE TABLE "ParticipantHistoryPeriod" (
    "participantId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL,
    "leftAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ParticipantHistoryPeriod_pkey" PRIMARY KEY ("participantId", "joinedAt"),
    CONSTRAINT "ParticipantHistoryPeriod_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
