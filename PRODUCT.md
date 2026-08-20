# Ditto product brief

## Current product

Ditto is a web-based AI coding workspace for GitHub repositories. A user signs in with GitHub, imports an authorized repository, and works with a coding agent inside a Cloudflare Sandbox.

Each workspace session has a conversation, a Git branch, and a worktree. The user can inspect agent activity, preview supported web applications, commit changes, push the session branch, and open a pull request.

Ditto currently requires a GitHub repository. The UI does not create a new repository or a project from an empty template. Terminal and code-browser tabs are visible but disabled. Pull requests are merged on GitHub.

## Users

Ditto serves two groups:

- People who want guided, plain-language help while changing a web application.
- Developers who want a browser-based coding agent without setting up the repository locally.

Both groups need to know which project, conversation, model, branch, and runtime they are using. Agent work must remain inspectable.

## Product direction

Ditto aims to support the full loop from an idea to a working web application. Creating a project from scratch is part of that direction, not an implemented feature.

Success means that users can understand what the agent is doing, review the resulting code, run the application, and export work without losing control of the repository.

## Product character

Ditto should feel calm, capable, and precise. It is a focused workspace, not an AI playground or a browser copy of a desktop IDE.

Avoid noisy dashboards, decorative metrics, neon effects, heavy glass treatments, and controls that hide what the agent is doing. Prefer clear state, accurate technical language, and restrained visual density.

## Design principles

1. Keep the project tangible. Show the active project, repository, model, branch, and runtime state.
2. Guide without patronizing. Explain consequences in plain language and keep technical labels accurate.
3. Keep agent work inspectable. Show tool activity, edits, errors, and Git state.
4. Use calm density. Support complex work without filling the screen with decoration.
5. Design one continuous loop for conversation, editing, preview, review, and export.

## Accessibility

Target WCAG AA. Support keyboard navigation, visible focus, readable contrast, accessible names, reduced motion, and explicit loading, disabled, and error states.
