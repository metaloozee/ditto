// Kept out of entry.ts: workerd rejects non-handler values exported from a worker main module.
export const CANDIDATE_FIXTURE_RESET_SCHEMA =
	"CREATE TABLE IF NOT EXISTS candidate_fixture_resets(resetId TEXT PRIMARY KEY,sessionId TEXT NOT NULL,previousGeneration INTEGER NOT NULL,generation INTEGER NOT NULL,phase TEXT NOT NULL,intent TEXT,observation TEXT,boot TEXT,cutoff INTEGER,predecessor TEXT,UNIQUE(sessionId,previousGeneration),UNIQUE(sessionId,predecessor))";
