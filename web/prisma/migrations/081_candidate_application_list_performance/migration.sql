-- Serve the candidate application list in the same order as its cursor query.
CREATE INDEX "JobApplication_candidateUserId_lastStageChangedAt_id_idx"
ON "JobApplication"("candidateUserId", "lastStageChangedAt" DESC, "id" DESC);
