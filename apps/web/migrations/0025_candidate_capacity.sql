CREATE TABLE candidate_capacity_claims (
 id TEXT PRIMARY KEY NOT NULL,
 pool TEXT NOT NULL CHECK(pool IN ('execution','model')),
 kind TEXT NOT NULL CHECK(kind IN ('executor','builder','preview','model')),
 ownerKey TEXT NOT NULL CHECK(length(ownerKey) BETWEEN 1 AND 512),
 userId TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('live','released')),
 claimedAt INTEGER NOT NULL,
 releasedAt INTEGER,
 evidence TEXT,
 CHECK((kind='model')=(pool='model')),
 CHECK((state='live' AND releasedAt IS NULL AND evidence IS NULL) OR (state='released' AND releasedAt IS NOT NULL AND evidence IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX candidate_capacity_claims_owner_uidx ON candidate_capacity_claims(kind,ownerKey);
--> statement-breakpoint
CREATE INDEX candidate_capacity_claims_live_idx ON candidate_capacity_claims(pool,state,userId);
--> statement-breakpoint
CREATE TRIGGER candidate_capacity_claims_final BEFORE UPDATE ON candidate_capacity_claims WHEN OLD.state='released' BEGIN SELECT RAISE(ABORT,'released claim is final'); END;
