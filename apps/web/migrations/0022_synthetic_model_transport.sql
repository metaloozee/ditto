CREATE TABLE codex_fixture_capabilities (
 userId TEXT PRIMARY KEY NOT NULL,
 generation INTEGER NOT NULL CHECK(generation > 0),
 revision INTEGER NOT NULL CHECK(revision > 0),
 snapshot TEXT NOT NULL CHECK(length(snapshot) <= 4096)
);
--> statement-breakpoint
CREATE TABLE model_request_admissions (
 effectId TEXT NOT NULL,
 windowId TEXT PRIMARY KEY NOT NULL,
 requestDigest TEXT NOT NULL CHECK(length(requestDigest) = 64),
 purpose TEXT NOT NULL CHECK(purpose IN ('generation','custom_summary','git_metadata')),
 state TEXT NOT NULL CHECK(state IN ('reserved','admitted','complete','failed_known','outcome_unknown')),
 createdAt INTEGER NOT NULL,
 updatedAt INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX model_request_admissions_window_idx ON model_request_admissions(windowId);
