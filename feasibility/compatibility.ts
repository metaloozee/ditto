// The model-trial Worker's compatibility settings, shared by the stack and the evidence.
// The date matches the pinned workerd (1.20261026.1). From 2026-08-04 the date alone turns on
// `nodejs_compat`, which Pi's OAuth refresh needs for `node:crypto`. Alchemy adds
// `new_module_registry` to the explicit flags.
export const COMPATIBILITY = { date: "2026-10-26", flags: [] as string[] };

export const COMPATIBILITY_TEXT = `compatibility date \`${COMPATIBILITY.date}\`, flags \`nodejs_compat\` (on by date) and \`new_module_registry\` (Alchemy default)`;
