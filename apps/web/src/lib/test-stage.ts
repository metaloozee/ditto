/** Refuses a test-only call anywhere but the test stage, the same way every time. */
export function testStageOnly(env: { TEST_HOOKS?: string }): void {
	if (env.TEST_HOOKS !== "on") throw new Error("Test stage only");
}
