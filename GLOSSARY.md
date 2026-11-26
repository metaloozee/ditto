# Ditto

Ditto recognizes returning users across its supported sign-in methods.

## Language

**Ditto account**  
The identity a person returns to in Ditto. One Ditto account can have several sign-in methods.

**Sign-in method**  
A way to prove ownership of a Ditto account. Ditto supports GitHub, Google, and a one-time code sent by email.

**Enabled sign-in method**  
A sign-in method the account holder established at registration or added in Settings. An account’s email address can be known to Ditto before email sign-in is enabled.

**Linked provider**  
A GitHub or Google identity authorized to sign in to a particular Ditto account. The provider used at registration is linked from the start. A signed-in user can link another provider in Settings.

**Display name**  
The name Ditto shows for a user. An OAuth provider can supply a display name even when it supplies neither a first name nor a last name.

**Model connection**

Permission a Ditto account holder gives their bots to use a model through the holder’s own plan or API key.

**Operator**

The person who runs a Ditto deployment and pays for it. When an owner deploys Ditto for themselves, they are its operator.
_Avoid_: Host, admin

**Included model**

A model the operator provides to every Ditto account on their deployment, paid for by the operator rather than through a model connection.
_Avoid_: Free model, default key

**Pair**

A model connection, or the included model, together with one of its models. Every turn runs on one pair.
_Avoid_: Model choice, route

**Default pair**

The pair the account holder chose for every bot without an override. The first model connection the holder connects becomes it; the included model is the default only once chosen.

**Override**

A bot's own pair, used in place of the default pair. It names a whole pair or nothing.
_Avoid_: Bot model

**Turn**

One message from the owner to a bot and the bot's reply. A turn keeps the pair it started on, unless the owner resumes it on another.

**Grant**

What a bot receives from the account for one call on a pair: the credential that call needs and nothing more, never the model connection itself.

**Fault**

Why a model connection or the included model can't answer for now: a limit, an outage, or a credential the provider no longer accepts. Ditto keeps checking until it answers, except for a refused credential, which waits for the account holder to reconnect.
_Avoid_: Trouble, error

**Interruption**

A turn stopped by a fault. It keeps its reply so far and its pair, and messages sent meanwhile wait behind it. It carries on on its own pair once the fault clears, or on another pair only when the owner resumes it there.

**Workspace**

The personal space where one owner works with Ditto and their team of bots on a shared computer.

**Chief of Staff**

Ditto, the permanent bot in a workspace. The owner can ask it to assign work to a specialist and check the result against the request.

**Face**

A bot's mark and name, wherever the owner picks or opens that bot.
_Avoid_: Avatar, icon

**Bot panel**

The panel beside the conversation that opens from a bot's face. It holds the bot's settings and the shared computer.
_Avoid_: Right panel, right sidebar

**Shared computer**

The one computer a workspace's bots share, with one disk holding its files and logins. Each bot works on its own screen there.
_Avoid_: Sandbox, desktop, VM

**Screen**

One bot's desktop on the shared computer, with its own keyboard and mouse, so bots work at the same time without waiting for each other.
_Avoid_: Desktop, session

**Live view**

The owner watching a screen while the bot keeps working. Watching never gives the owner control; take-over does.
_Avoid_: Stream, Live View link

**Shared profile**

The preferences and facts the owner explicitly shares for use by the whole team. Ditto maintains the profile on the owner’s behalf.

**Take-over**

A transfer of screen control to the workspace owner that lasts until the owner explicitly hands it back. During take-over, the owner can complete a step such as signing in without bots observing or operating that screen.

**Deliverable**

A file a bot publishes as the output of a task. The owner can open it after the shared computer stops.

**Desk**

The workspace owner’s inbox for requests that need a decision or take-over.

**Approved sites**

The exact sites a workspace's shared computer may reach. A new workspace has none, so its shared computer reaches nothing until the owner approves a site.
_Avoid_: Allowlist, whitelist, host list

**Site set**

A named group of approved sites the owner can allow together, such as everything Google Workspace needs to sign in and work.
_Avoid_: Preset, bundle

**Site request**

A bot asking the owner, in the conversation, to approve a site the shared computer was blocked from reaching.
_Avoid_: Permission prompt, popup
