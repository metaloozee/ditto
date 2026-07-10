export const DITTO_GIT_AUTHOR_NAME = "Ditto";
export const DITTO_GIT_AUTHOR_EMAIL = "ditto@users.noreply.github.com";

export function dittoGitAuthorEnv(): Record<string, string> {
	return {
		GIT_AUTHOR_NAME: DITTO_GIT_AUTHOR_NAME,
		GIT_AUTHOR_EMAIL: DITTO_GIT_AUTHOR_EMAIL,
		GIT_COMMITTER_NAME: DITTO_GIT_AUTHOR_NAME,
		GIT_COMMITTER_EMAIL: DITTO_GIT_AUTHOR_EMAIL,
	};
}
