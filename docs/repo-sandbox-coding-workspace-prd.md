# Repo-Sandbox AI Coding Workspace PRD

**Owner:** Ayan
**Status:** Draft
**Date:** 2026-06-26

## 1. Overview

Build a browser-based AI coding workspace where a user selects a GitHub repository, the repo is cloned into an isolated Cloudflare Sandbox, and a chat-based agent helps inspect, modify, run, debug, and preview the application.

The product is not a generic app generator. It is a **repo-native AI pair-programming environment** for working on existing codebases safely and interactively.

## 2. Problem Statement

Today, developers rely on a scattered workflow to understand and change an existing repository:
- clone locally
- install dependencies
- run the app
- inspect logs
- edit code manually
- repeat until fixed

That workflow is slow for small changes and too risky for untrusted or unfamiliar code. Existing AI app builders are strong at starting from scratch, but less focused on the realities of working inside an existing repository.

## 3. Product Goals

1. Let a user connect a GitHub repo and open it in a sandboxed workspace.
2. Provide a chat interface that can drive code changes through an agent.
3. Support safe execution of repo commands, file edits, build/test loops, and preview URLs.
4. Make the system feel fast, trustworthy, and understandable.
5. Keep the user in control through reviewable diffs and explicit actions.

## 4. Non-Goals

- Replacing GitHub as the source of truth.
- Building a full IDE.
- Supporting arbitrary multi-user real-time collaboration in v1.
- Building a generalized website generator for blank-slate projects.
- Automatically merging code without user review.

## 5. Target Users

### Primary
- Founders, indie developers, and small teams working on existing repos.
- Engineers who want faster debugging, feature work, and repo onboarding.

### Secondary
- Product or design teammates who need to make safe code changes without local setup.
- Agencies and contractors working across many client repositories.

## 6. Core User Journey

1. User signs in.
2. User selects a GitHub repository.
3. System clones the repo into a sandbox.
4. System installs dependencies and starts the app.
5. User opens a chat panel and asks for a change.
6. Agent reads files, proposes or applies edits, and runs commands.
7. User reviews diffs, logs, and preview output.
8. User exports or pushes changes back to GitHub.

## 7. Experience Principles

- **Chat is the control plane.** Users should be able to steer the workspace conversationally.
- **Sandbox is the safety boundary.** All execution happens inside isolated infrastructure.
- **Evidence over claims.** The agent should show file diffs, command output, and previews.
- **User approval matters.** Destructive or repo-wide actions require explicit confirmation.
- **Repo-native, not prompt-native.** The user’s codebase is the center of the product.

## 8. Functional Requirements

### 8.1 Repository import
- User can choose a GitHub repository they have access to.
- The selected repo is cloned into a sandboxed workspace.
- The system can re-open the same workspace for the same repo/session identity.

### 8.2 Build and run
- The system installs project dependencies.
- The system runs the app or a suitable dev command.
- The system surfaces build errors and runtime logs in the UI.

### 8.3 Chat-driven agent loop
- The user can send natural-language instructions in a chat panel.
- The agent can inspect files, edit files, and execute commands.
- The agent should explain what it changed and why.
- The user can ask follow-up questions about the codebase.

### 8.4 Preview and verification
- The sandbox can expose a running service through a preview URL.
- The user can inspect the app in-browser.
- The system can rerun tests or commands after edits.

### 8.5 Review and export
- The user can review changed files before accepting them.
- The user can copy changes back to GitHub through a commit/PR workflow.
- The user can discard a workspace or restart from the repository baseline.

## 9. MVP Scope

### In scope for v1
- GitHub repo selection
- Sandbox clone and build
- Chat UI
- File read/write tools
- Command execution
- Basic diff view
- Preview URL exposure
- Minimal error handling and retry UX

### Out of scope for v1
- Multi-agent orchestration
- Branch management UI
- Advanced permissions model
- Full code review workflow
- Automatic production deployment
- Rich project analytics

## 10. Success Metrics

### Activation
- % of users who successfully import a repo and reach a running preview.

### Engagement
- % of sessions where the chat agent makes at least one meaningful code change.

### Value
- Median time from repo import to first successful preview.
- % of sessions where a build or test failure is resolved within the sandbox.

### Quality
- User trust score from post-session feedback.
- Low rate of failed or confusing agent actions.

## 11. Risks and Constraints

- **Sandbox cold starts:** can slow the first interaction.
- **Repo complexity:** some repos need unusual setup commands.
- **Trust:** users need clear visibility into what the agent changed.
- **Security:** untrusted code must stay isolated.
- **GitHub auth and permissions:** import flow must respect repo access.

## 12. Product Differentiation

Compared with Bolt, v0, and Lovable, this product is narrower and more practical:
- It focuses on **existing repositories**, not just starting from a blank prompt.
- It centers on **safe execution inside Cloudflare Sandbox**.
- It treats chat as a **developer workflow**, not just an app-generation UI.
- It is designed to be a **repo-native coding assistant** rather than a general-purpose builder.

## 13. Open Questions

- Should the workspace be tied to a GitHub repo, a branch, or a session snapshot?
- Should the agent apply edits automatically or always request confirmation first?
- What is the minimum viable commit/push workflow?
- Which repo setup commands should be inferred versus manually configured?
- What should happen when the repo build fails before the chat loop starts?

## 14. Recommended Positioning

One-line positioning:

**A secure, repo-native AI coding workspace that helps users inspect, edit, run, and preview existing GitHub projects inside Cloudflare Sandbox.**

## 15. Next Step

Use this PRD to write the implementation plan for:
- GitHub repo import
- sandbox initialization
- chat agent integration
- preview and diff review UI
