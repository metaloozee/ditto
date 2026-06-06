import { createFileRoute } from "@tanstack/react-router";
import { SignIn } from "./sign-in-page";

export const Route = createFileRoute("/sign-in")({
	component: SignIn,
});
