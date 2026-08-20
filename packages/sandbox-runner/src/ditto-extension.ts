import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	dittoOpenPullRequestTool,
	dittoPushBranchTool,
} from "./ditto-git-tools.js";

export default function (pi: ExtensionAPI) {
	pi.registerTool(dittoPushBranchTool);
	pi.registerTool(dittoOpenPullRequestTool);
}
