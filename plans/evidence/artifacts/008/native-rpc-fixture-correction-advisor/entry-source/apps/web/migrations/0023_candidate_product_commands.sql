CREATE TABLE candidate_workspace_claims (
 id INTEGER PRIMARY KEY NOT NULL CHECK(id=1),
 sessionId TEXT NOT NULL UNIQUE,
 identityId TEXT NOT NULL UNIQUE,
 userId TEXT NOT NULL,
 projectId TEXT NOT NULL,
 createdAt INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE candidate_command_decisions (
 commandId TEXT PRIMARY KEY NOT NULL,
 sessionId TEXT NOT NULL,
 ownerVersion INTEGER NOT NULL CHECK(ownerVersion=1),
 identityId TEXT NOT NULL,
 runId TEXT NOT NULL,
 runEpoch INTEGER NOT NULL CHECK(runEpoch>0),
 payloadDigest TEXT NOT NULL CHECK(length(payloadDigest)=64),
 queueDeadlineAt INTEGER NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('started','expired')),
 decidedAt INTEGER NOT NULL,
 CHECK((decision='started' AND decidedAt<queueDeadlineAt) OR (decision='expired' AND decidedAt>=queueDeadlineAt))
);
