# Run bots on the owner’s model connection

Every model request uses access supplied by the workspace owner, including during testing. The first two supported connections are the owner’s ChatGPT plan and an OpenCode API key. Ditto supplies no shared upstream key. If ChatGPT plan access is unavailable, the developer can supply their own `OPENCODE_API_KEY` to exercise the harness through the first delegated task, while hosted ChatGPT onboarding retains its own technical and approval gates.

The owner selects a model connection and a specific model together in Settings. Every bot inherits that pair unless the owner chooses a complete pair in the bot’s settings. A healthy turn keeps its original pair until it finishes or the owner stops it. Future turns use the current selection in the same conversation.

A turn interrupted by a provider limit may resume when its original connection recovers. Changing Settings leaves interrupted work paused on the new connection until the owner explicitly resumes that task with the new pair. This prevents a single settings change from moving several unfinished tasks onto a paid key.
