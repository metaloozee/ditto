# Keep destination controls on computers with private logins

Bots with shell access share the computer’s signed-in sessions, so a computer holding private logins may contact only destinations approved for that workspace. If a workflow requires unrestricted internet access on the current provider, mark it unsupported there and evaluate another provider that can enforce the same restriction.

Evaluate compatibility per workflow. Record “works with take-over” when the owner completes a login or challenge and the bot finishes the representative task after control returns. A workflow that needs the owner to operate the site step by step fails the trial.

ADR-0014 lets the owner allow every site, keeping logins on. While that is on, this restriction does not hold.
