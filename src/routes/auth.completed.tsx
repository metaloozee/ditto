import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from "react";

export const Route = createFileRoute('/auth/completed')({
  component: GitHubAppInstallComplete,
})

function GitHubAppInstallComplete() {
  useEffect(() => {
    window.opener?.postMessage(
      { type: "github-app-install-complete" },
      window.location.origin,
    );
    window.close();
  }, []);

  return (
    <main className="flex min-h-svh items-center justify-center p-6 text-center">
      <p className="text-sm text-muted-foreground">
        GitHub App setup complete. Closing...
      </p>
    </main>
  );
}