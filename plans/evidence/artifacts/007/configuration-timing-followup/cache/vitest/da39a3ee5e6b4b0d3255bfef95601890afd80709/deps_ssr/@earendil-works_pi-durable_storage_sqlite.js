import {
  StorageRejected,
  idFromNumber,
  seqFromNumber
} from "./chunk-XWH7TXR6.js";
import {
  apply
} from "./chunk-EOP7IIM4.js";
import "./chunk-PZ5AY32C.js";

// ../../node_modules/.pnpm/@earendil-works+pi-durable@1.0.1_@aws-sdk+credential-provider-node@3.972.84_@modelconte_867545391487edcd36123475ad2fe1d0/node_modules/@earendil-works/pi-durable/dist/storage/sqlite/migrations.js
var INITIAL_SCHEMA = [
  `CREATE TABLE durable_metadata (
		singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
		next_id TEXT NOT NULL,
		next_seq INTEGER NOT NULL
	) STRICT`,
  `INSERT INTO durable_metadata (singleton, next_id, next_seq) VALUES (1, '2', 1)`,
  `CREATE TABLE record_ids (
		id INTEGER PRIMARY KEY,
		record_type TEXT NOT NULL CHECK (record_type IN ('conversation', 'entry', 'task', 'submission', 'document'))
	) STRICT`,
  `CREATE TABLE conversations (
		id INTEGER PRIMARY KEY,
		owner_conversation_id INTEGER,
		owner_task_id INTEGER,
		record TEXT NOT NULL CHECK (json_valid(record))
	) STRICT`,
  "CREATE INDEX conversations_by_owner_conversation ON conversations (owner_conversation_id, id)",
  "CREATE INDEX conversations_by_owner_task ON conversations (owner_task_id, id)",
  `CREATE TABLE entries (
		id INTEGER PRIMARY KEY,
		conversation_id INTEGER NOT NULL,
		head INTEGER,
		commit_seq INTEGER NOT NULL,
		record TEXT NOT NULL CHECK (json_valid(record))
	) STRICT`,
  "CREATE INDEX entries_by_conversation ON entries (conversation_id, id DESC)",
  "CREATE INDEX entry_heads_by_conversation ON entries (conversation_id, id DESC) WHERE head IS NOT NULL",
  `CREATE TABLE tasks (
		id INTEGER PRIMARY KEY,
		conversation_id INTEGER NOT NULL,
		kind TEXT NOT NULL,
		status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'waiting', 'completing', 'terminal')),
		abort_requested INTEGER NOT NULL CHECK (abort_requested IN (0, 1)),
		background INTEGER NOT NULL CHECK (background IN (0, 1)),
		record TEXT NOT NULL CHECK (json_valid(record))
	) STRICT`,
  "CREATE INDEX tasks_by_status ON tasks (status, id)",
  "CREATE INDEX tasks_by_conversation ON tasks (conversation_id, id)",
  "CREATE INDEX tasks_by_kind ON tasks (kind, id)",
  "CREATE INDEX tasks_by_abort_requested ON tasks (abort_requested, id)",
  "CREATE INDEX tasks_by_background ON tasks (background, id)",
  `CREATE TABLE submissions (
		id INTEGER PRIMARY KEY,
		conversation_id INTEGER NOT NULL,
		request_id TEXT,
		status TEXT NOT NULL CHECK (status IN ('queued', 'placed', 'done', 'unanswered')),
		record TEXT NOT NULL CHECK (json_valid(record))
	) STRICT`,
  "CREATE INDEX submissions_by_request ON submissions (conversation_id, request_id)",
  "CREATE INDEX submissions_by_conversation ON submissions (conversation_id, id)",
  "CREATE INDEX submissions_by_status ON submissions (status, id)",
  `CREATE TABLE documents (
		id INTEGER PRIMARY KEY,
		kind TEXT NOT NULL,
		family INTEGER NOT NULL CHECK (family IN (0, 1)),
		key_value TEXT NOT NULL,
		scope_kind TEXT NOT NULL CHECK (scope_kind IN ('session', 'conversation', 'task')),
		owner_id INTEGER NOT NULL,
		created_at INTEGER NOT NULL,
		retired_at INTEGER,
		record TEXT NOT NULL CHECK (json_valid(record))
	) STRICT`,
  `CREATE INDEX documents_by_address
		ON documents (kind, scope_kind, owner_id, family, key_value, created_at DESC, retired_at)`,
  "CREATE INDEX documents_by_scope ON documents (scope_kind, owner_id, id)",
  "CREATE INDEX documents_by_scope_kind ON documents (scope_kind, owner_id, kind, id)",
  `CREATE TABLE document_revisions (
		document_id INTEGER NOT NULL,
		seq INTEGER NOT NULL,
		kind TEXT NOT NULL CHECK (kind IN ('base', 'delta')),
		version INTEGER NOT NULL,
		content TEXT NOT NULL CHECK (json_valid(content)),
		PRIMARY KEY (document_id, seq)
	) STRICT`,
  "CREATE INDEX document_revisions_by_kind ON document_revisions (document_id, kind, seq DESC)"
];
var SQLITE_MIGRATIONS = [{ version: 1, statements: INITIAL_SCHEMA }];
var CURRENT_SQLITE_SCHEMA_VERSION = SQLITE_MIGRATIONS.at(-1)?.version ?? 0;
async function applySqliteMigrations(database, migrations = SQLITE_MIGRATIONS) {
  for (let index = 0; index < migrations.length; index++) {
    if (migrations[index]?.version !== index + 1) {
      throw new Error("Durable SQLite migrations must have contiguous versions starting at 1");
    }
  }
  await database.transaction(async (transaction) => {
    await transaction.exec(`CREATE TABLE IF NOT EXISTS durable_schema (
			singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
			version INTEGER NOT NULL CHECK (version >= 0)
		) STRICT`);
    await transaction.run("INSERT OR IGNORE INTO durable_schema (singleton, version) VALUES (1, 0)");
    const row = await transaction.get("SELECT version FROM durable_schema WHERE singleton = 1");
    if (row === void 0)
      throw new Error("Durable SQLite schema metadata is missing");
    const currentVersion = migrations.at(-1)?.version ?? 0;
    if (row.version > currentVersion) {
      throw new Error(`Durable SQLite schema version ${row.version} is newer than supported version ${currentVersion}`);
    }
    for (const migration of migrations) {
      if (migration.version <= row.version)
        continue;
      for (const statement of migration.statements)
        await transaction.exec(statement);
      await transaction.run("UPDATE durable_schema SET version = ? WHERE singleton = 1", migration.version);
    }
  });
}

// ../../node_modules/.pnpm/@earendil-works+pi-durable@1.0.1_@aws-sdk+credential-provider-node@3.972.84_@modelconte_867545391487edcd36123475ad2fe1d0/node_modules/@earendil-works/pi-durable/dist/storage/sqlite/storage.js
var parseJson = (value) => JSON.parse(value);
var encodeJson = (value) => JSON.stringify(value);
var encodeIndexedString = (value) => JSON.stringify(value);
var cursorId = (cursor) => {
  const after = cursor?.after;
  if (after === void 0)
    return void 0;
  if (typeof after !== "number" || !Number.isSafeInteger(after))
    throw new TypeError("Invalid storage cursor");
  return idFromNumber(after);
};
var page = (values, limit) => {
  const items = values.slice(0, limit);
  if (values.length <= limit)
    return { items };
  return { items, next: { after: items.at(-1).id } };
};
var scopeColumns = (scope) => {
  switch (scope.kind) {
    case "session":
      return { scopeKind: "session", ownerId: 0 };
    case "conversation":
      return { scopeKind: "conversation", ownerId: scope.conversationId };
    case "task":
      return { scopeKind: "task", ownerId: scope.taskId };
  }
};
var addressParts = (address) => {
  const scope = scopeColumns(address.scope);
  return {
    kind: encodeIndexedString(address.kind),
    ...scope,
    family: address.key === void 0 ? 0 : 1,
    keyValue: encodeIndexedString(address.key ?? "")
  };
};
var addressKey = (address) => {
  const parts = addressParts(address);
  return JSON.stringify([parts.kind, parts.scopeKind, parts.ownerId, parts.family, parts.keyValue]);
};
var isAliveAt = (record, at) => {
  if (at === "current")
    return record.retiredAt === void 0;
  return record.createdAt <= at && (record.retiredAt === void 0 || at < record.retiredAt);
};
var isCurrentOnly = (record) => record.scope.kind !== "conversation" || record.history === "latest";
var writeId = (write) => {
  switch (write.type) {
    case "conversation":
    case "entry":
    case "task":
    case "submission":
      return write.value.id;
    case "document.create":
    case "document.copy":
      return write.record.id;
    case "document.change":
    case "document.retire":
      return void 0;
  }
};
var SqliteStorage = class _SqliteStorage {
  db;
  nextId;
  closed = false;
  closing;
  admittedReads = 0;
  readsDrained;
  constructor(db, nextId) {
    this.db = db;
    this.nextId = nextId;
  }
  /** Initialize storage over an owned SQLite database facade. */
  static async open(db) {
    try {
      await applySqliteMigrations(db);
      const metadata = await db.get("SELECT next_id, next_seq FROM durable_metadata WHERE singleton = 1");
      if (metadata === void 0)
        throw new Error("Durable SQLite metadata is missing");
      return new _SqliteStorage(db, Number(metadata.next_id));
    } catch (error) {
      try {
        await db.close();
      } catch {
      }
      throw error;
    }
  }
  async commit(writes, _context) {
    this.assertOpen();
    const documentActions = this.prepareDocumentActions(writes);
    const candidateNextId = this.candidateNextId(writes);
    const seq = await this.db.transaction(async (transaction) => {
      const metadata = await transaction.get("SELECT next_id, next_seq FROM durable_metadata WHERE singleton = 1");
      if (metadata === void 0)
        throw new Error("Durable SQLite metadata is missing");
      const committedSeq = seqFromNumber(metadata.next_seq);
      await this.checkGlobalIds(transaction, writes);
      await this.checkDocumentActions(transaction, documentActions);
      for (const write of writes)
        await this.applyTableWrite(transaction, write, committedSeq);
      await this.applyDocumentActions(transaction, documentActions, committedSeq);
      await transaction.run("UPDATE durable_metadata SET next_id = ?, next_seq = ? WHERE singleton = 1", String(Math.max(Number(metadata.next_id), candidateNextId)), committedSeq + 1);
      return committedSeq;
    });
    this.nextId = Math.max(this.nextId, candidateNextId);
    return seq;
  }
  async mintId() {
    this.assertOpen();
    if (!Number.isSafeInteger(this.nextId))
      throw new Error("ID space is exhausted");
    return idFromNumber(this.nextId++);
  }
  async conversation(id, _context) {
    this.assertOpen();
    const row = await this.db.get("SELECT record FROM conversations WHERE id = ?", id);
    return row === void 0 ? void 0 : parseJson(row.record);
  }
  async scanConversations(query, limit, cursor, _context) {
    this.assertOpen();
    const clauses = ["id > ?"];
    const params = [cursorId(cursor) ?? -1];
    if (query.ownerConversationId !== void 0) {
      clauses.push("owner_conversation_id = ?");
      params.push(query.ownerConversationId);
    }
    if (query.ownerTaskId !== void 0) {
      clauses.push("owner_task_id = ?");
      params.push(query.ownerTaskId);
    }
    params.push(limit + 1);
    const rows = await this.db.all(`SELECT record FROM conversations WHERE ${clauses.join(" AND ")} ORDER BY id LIMIT ?`, ...params);
    return page(rows.map((row) => parseJson(row.record)), limit);
  }
  entry(idOrConversationId, idOrContext, context) {
    return this.admitRead(() => this.readEntry(idOrConversationId, idOrContext, context));
  }
  findLatestHeadMarker(conversationId, atOrBeforeEntryId, _context) {
    return this.admitRead(() => this.readLatestHeadMarker(conversationId, atOrBeforeEntryId));
  }
  scanEntries(query, limit, cursor, _context) {
    return this.admitRead(() => this.readEntries(query, limit, cursor));
  }
  async readEntry(idOrConversationId, idOrContext, context) {
    const id = context === void 0 ? idFromNumber(idOrConversationId) : typeof idOrContext === "number" ? idFromNumber(idOrContext) : void 0;
    if (id === void 0)
      throw new TypeError("Storage.entry() requires an entry ID");
    let conversation;
    if (context !== void 0) {
      const conversationId = idFromNumber(idOrConversationId);
      conversation = await this.readConversation(conversationId);
      if (conversation === void 0)
        throw new Error(`Unknown conversation: ${conversationId}`);
    }
    const row = await this.db.get("SELECT record, commit_seq FROM entries WHERE id = ?", id);
    if (row === void 0)
      return void 0;
    const entry = parseJson(row.record);
    if (conversation !== void 0) {
      let upperEntryId = Number.POSITIVE_INFINITY;
      while (conversation.id !== entry.conversationId) {
        if (conversation.parent === void 0)
          return void 0;
        upperEntryId = Math.min(upperEntryId, conversation.parent.at);
        conversation = await this.readConversation(conversation.parent.conversationId);
      }
      if (entry.id > upperEntryId)
        return void 0;
    }
    return { entry, commitSeq: seqFromNumber(row.commit_seq) };
  }
  async readLatestHeadMarker(conversationId, atOrBeforeEntryId) {
    let conversation = await this.readConversation(conversationId);
    if (conversation === void 0)
      throw new Error(`Unknown conversation: ${conversationId}`);
    let upper = atOrBeforeEntryId;
    while (true) {
      const row = upper === void 0 ? await this.db.get("SELECT record FROM entries WHERE conversation_id = ? AND head IS NOT NULL ORDER BY id DESC LIMIT 1", conversation.id) : await this.db.get("SELECT record FROM entries WHERE conversation_id = ? AND head IS NOT NULL AND id <= ? ORDER BY id DESC LIMIT 1", conversation.id, upper);
      if (row !== void 0)
        return parseJson(row.record);
      if (conversation.parent === void 0)
        return void 0;
      upper = upper === void 0 ? conversation.parent.at : Math.min(upper, conversation.parent.at);
      conversation = await this.readConversation(conversation.parent.conversationId);
    }
  }
  async readEntries(query, limit, cursor) {
    let conversation = await this.readConversation(query.conversationId);
    if (conversation === void 0)
      throw new Error(`Unknown conversation: ${query.conversationId}`);
    const after = cursorId(cursor);
    let upper = query.maxEntryId;
    if (after !== void 0)
      upper = Math.min(upper ?? Number.MAX_SAFE_INTEGER, after - 1);
    const values = [];
    while (true) {
      const clauses = ["conversation_id = ?"];
      const params = [conversation.id];
      if (query.minEntryId !== void 0) {
        clauses.push("id >= ?");
        params.push(query.minEntryId);
      }
      if (upper !== void 0) {
        clauses.push("id <= ?");
        params.push(upper);
      }
      params.push(limit + 1 - values.length);
      const rows = await this.db.all(`SELECT record FROM entries WHERE ${clauses.join(" AND ")} ORDER BY id DESC LIMIT ?`, ...params);
      values.push(...rows.map((row) => parseJson(row.record)));
      if (values.length > limit || conversation.parent === void 0)
        break;
      upper = upper === void 0 ? conversation.parent.at : Math.min(upper, conversation.parent.at);
      if (query.minEntryId !== void 0 && upper < query.minEntryId)
        break;
      conversation = await this.readConversation(conversation.parent.conversationId);
    }
    return page(values, limit);
  }
  async task(id, _context) {
    this.assertOpen();
    const row = await this.db.get("SELECT record FROM tasks WHERE id = ?", id);
    return row === void 0 ? void 0 : parseJson(row.record);
  }
  async scanTasks(query, limit, cursor, _context) {
    this.assertOpen();
    const clauses = ["id > ?"];
    const params = [cursorId(cursor) ?? -1];
    if (query.conversationId !== void 0) {
      clauses.push("conversation_id = ?");
      params.push(query.conversationId);
    }
    if (query.kind !== void 0) {
      clauses.push("kind = ?");
      params.push(encodeIndexedString(query.kind));
    }
    if (query.status !== void 0) {
      clauses.push("status = ?");
      params.push(query.status);
    }
    if (query.abortRequested !== void 0) {
      clauses.push("abort_requested = ?");
      params.push(query.abortRequested ? 1 : 0);
    }
    if (query.background !== void 0) {
      clauses.push("background = ?");
      params.push(query.background ? 1 : 0);
    }
    params.push(limit + 1);
    const rows = await this.db.all(`SELECT record FROM tasks WHERE ${clauses.join(" AND ")} ORDER BY id LIMIT ?`, ...params);
    return page(rows.map((row) => parseJson(row.record)), limit);
  }
  async submission(id, _context) {
    this.assertOpen();
    const row = await this.db.get("SELECT record FROM submissions WHERE id = ?", id);
    return row === void 0 ? void 0 : parseJson(row.record);
  }
  async scanSubmissions(query, limit, cursor, _context) {
    this.assertOpen();
    const clauses = ["id > ?"];
    const params = [cursorId(cursor) ?? -1];
    if (query.conversationId !== void 0) {
      clauses.push("conversation_id = ?");
      params.push(query.conversationId);
    }
    if (query.status !== void 0) {
      clauses.push("status = ?");
      params.push(query.status);
    }
    params.push(limit + 1);
    const rows = await this.db.all(`SELECT record FROM submissions WHERE ${clauses.join(" AND ")} ORDER BY id LIMIT ?`, ...params);
    return page(rows.map((row) => parseJson(row.record)), limit);
  }
  async submissionByRequest(conversationId, requestId, _context) {
    this.assertOpen();
    const row = await this.db.get("SELECT record FROM submissions WHERE conversation_id = ? AND request_id = ?", conversationId, encodeIndexedString(requestId));
    return row === void 0 ? void 0 : parseJson(row.record);
  }
  async findDocument(address, at, _context) {
    this.assertOpen();
    const parts = addressParts(address);
    const sql = at === "current" ? `SELECT record FROM documents
					WHERE kind = ? AND scope_kind = ? AND owner_id = ? AND family = ? AND key_value = ?
					AND retired_at IS NULL ORDER BY created_at DESC LIMIT 1` : `SELECT record FROM documents
					WHERE kind = ? AND scope_kind = ? AND owner_id = ? AND family = ? AND key_value = ?
					AND created_at <= ? AND (retired_at IS NULL OR retired_at > ?)
					ORDER BY created_at DESC LIMIT 1`;
    const params = [parts.kind, parts.scopeKind, parts.ownerId, parts.family, parts.keyValue];
    if (at !== "current")
      params.push(at, at);
    const row = await this.db.get(sql, ...params);
    return row === void 0 ? void 0 : parseJson(row.record);
  }
  async document(id, at, _context) {
    this.assertOpen();
    return this.db.transaction((transaction) => this.materializeDocument(transaction, id, at));
  }
  async scanDocuments(query, limit, cursor, _context) {
    this.assertOpen();
    const scope = scopeColumns(query.scope);
    const clauses = ["scope_kind = ?", "owner_id = ?", "id > ?"];
    const params = [scope.scopeKind, scope.ownerId, cursorId(cursor) ?? -1];
    if (query.kind !== void 0) {
      clauses.push("kind = ?");
      params.push(encodeIndexedString(query.kind));
    }
    if (query.at === "current") {
      clauses.push("retired_at IS NULL");
    } else {
      clauses.push("created_at <= ?", "(retired_at IS NULL OR retired_at > ?)");
      params.push(query.at, query.at);
    }
    params.push(limit + 1);
    const rows = await this.db.all(`SELECT record FROM documents WHERE ${clauses.join(" AND ")} ORDER BY id LIMIT ?`, ...params);
    return page(rows.map((row) => parseJson(row.record)), limit);
  }
  close(_context) {
    if (this.closing === void 0) {
      this.closed = true;
      this.closing = this.closeDatabase();
    }
    return this.closing;
  }
  async closeDatabase() {
    if (this.admittedReads > 0) {
      await new Promise((resolve) => {
        this.readsDrained = resolve;
      });
    }
    await this.db.close();
  }
  /**
   * Run a read that issues several queries. Close waits for admitted reads, so their later queries never reach a
   * closed database. Single-query reads and transactions are already ordered before close by the database.
   */
  async admitRead(read) {
    this.assertOpen();
    this.admittedReads++;
    try {
      return await read();
    } finally {
      if (--this.admittedReads === 0)
        this.readsDrained?.();
    }
  }
  async readConversation(id) {
    const row = await this.db.get("SELECT record FROM conversations WHERE id = ?", id);
    return row === void 0 ? void 0 : parseJson(row.record);
  }
  async materializeDocument(executor, id, at) {
    const row = await executor.get("SELECT record FROM documents WHERE id = ?", id);
    if (row === void 0)
      return void 0;
    const record = parseJson(row.record);
    if (at !== "current" && isCurrentOnly(record)) {
      throw new Error(`Document ${id} does not retain historical content`);
    }
    if (!isAliveAt(record, at))
      return void 0;
    const upper = at === "current" ? Number.MAX_SAFE_INTEGER : at;
    const base = await executor.get(`SELECT seq, kind, version, content FROM document_revisions
				WHERE document_id = ? AND kind = 'base' AND seq <= ? ORDER BY seq DESC LIMIT 1`, id, upper);
    if (base === void 0)
      throw new Error(`Document ${id} is missing a required base`);
    let value = parseJson(base.content);
    const tail = await executor.all(`SELECT seq, kind, version, content FROM document_revisions
				WHERE document_id = ? AND seq > ? AND seq <= ? ORDER BY seq`, id, base.seq, upper);
    for (const revision of tail) {
      if (revision.kind !== "delta" || revision.version !== base.version) {
        throw new Error(`Document ${id} crosses a stored version boundary without a base`);
      }
      value = apply(value, parseJson(revision.content));
    }
    return { record, version: base.version, value, deltasSinceBase: tail.length };
  }
  candidateNextId(writes) {
    let nextId = this.nextId;
    for (const write of writes) {
      const id = writeId(write);
      if (id !== void 0)
        nextId = Math.max(nextId, id + 1);
    }
    return nextId;
  }
  async checkGlobalIds(executor, writes) {
    const claimed = /* @__PURE__ */ new Map();
    for (const write of writes) {
      if (write.type === "document.change" || write.type === "document.retire")
        continue;
      const document = write.type === "document.create" || write.type === "document.copy";
      const table = document ? "document" : write.type;
      const id = document ? write.record.id : write.value.id;
      const existing = (await executor.get("SELECT record_type FROM record_ids WHERE id = ?", id))?.record_type;
      const earlier = claimed.get(id);
      if (table === "conversation" || table === "entry" || table === "document") {
        if (existing !== void 0)
          throw new Error(`ID ${id} already belongs to ${existing}`);
        if (earlier !== void 0)
          throw new Error(`ID ${id} is written more than once`);
      } else {
        if (existing !== void 0 && existing !== table)
          throw new Error(`ID ${id} already belongs to ${existing}`);
        if (earlier !== void 0 && earlier !== table)
          throw new Error(`ID ${id} is written as two record types`);
      }
      claimed.set(id, table);
    }
  }
  prepareDocumentActions(writes) {
    const actions = /* @__PURE__ */ new Map();
    for (const write of writes) {
      if (write.type !== "document.create" && write.type !== "document.copy" && write.type !== "document.change" && write.type !== "document.retire") {
        continue;
      }
      const id = write.type === "document.create" || write.type === "document.copy" ? write.record.id : write.id;
      let action = actions.get(id);
      if (action === void 0) {
        action = { retire: false };
        actions.set(id, action);
      }
      switch (write.type) {
        case "document.create":
          if (action.create !== void 0 || action.content !== void 0 || action.copy !== void 0) {
            throw new Error(`Document ${id} has more than one content command`);
          }
          action.create = write.record;
          action.content = write.content;
          break;
        case "document.copy":
          if (action.create !== void 0 || action.content !== void 0 || action.copy !== void 0) {
            throw new Error(`Document ${id} has more than one content command`);
          }
          action.create = write.record;
          action.copy = write.source;
          break;
        case "document.change":
          if (action.content !== void 0 || action.copy !== void 0) {
            throw new Error(`Document ${id} has more than one content command`);
          }
          action.content = write.content;
          break;
        case "document.retire":
          if (action.retire)
            throw new Error(`Document ${id} is retired more than once`);
          action.retire = true;
          break;
      }
    }
    return actions;
  }
  async checkDocumentActions(executor, actions) {
    const liveCounts = /* @__PURE__ */ new Map();
    for (const [id, action] of actions) {
      if (action.copy !== void 0 && actions.has(action.copy.id)) {
        throw new StorageRejected(`Document copy ${id} source is changed in the copy batch`);
      }
      const row = await executor.get("SELECT record FROM documents WHERE id = ?", id);
      const existing = row === void 0 ? void 0 : parseJson(row.record);
      if (action.create === void 0 && existing === void 0)
        throw new Error(`Unknown document: ${id}`);
      if (action.create !== void 0 && existing !== void 0)
        throw new Error(`Document ${id} already exists`);
      if (existing?.retiredAt !== void 0)
        throw new Error(`Document ${id} is retired`);
      if (action.content?.kind === "delta") {
        const previous = await executor.get("SELECT version FROM document_revisions WHERE document_id = ? ORDER BY seq DESC LIMIT 1", id);
        if (previous === void 0)
          throw new Error(`Document ${id} delta has no base`);
        if (previous.version !== action.content.version) {
          throw new Error(`Document ${id} version transition requires a base`);
        }
      }
      const record = action.create ?? existing;
      const key = addressKey(record);
      let live = liveCounts.get(key);
      if (live === void 0)
        live = await this.currentDocumentId(executor, record) === void 0 ? 0 : 1;
      if (action.retire && existing !== void 0)
        live--;
      if (action.create !== void 0 && !action.retire)
        live++;
      liveCounts.set(key, live);
    }
    for (const live of liveCounts.values()) {
      if (live > 1)
        throw new Error("Document address already has a current incarnation");
    }
  }
  async currentDocumentId(executor, address) {
    const parts = addressParts(address);
    const id = (await executor.get(`SELECT id FROM documents
				WHERE kind = ? AND scope_kind = ? AND owner_id = ? AND family = ? AND key_value = ? AND retired_at IS NULL
				LIMIT 1`, parts.kind, parts.scopeKind, parts.ownerId, parts.family, parts.keyValue))?.id;
    return id === void 0 ? void 0 : idFromNumber(id);
  }
  async applyTableWrite(executor, write, seq) {
    switch (write.type) {
      case "conversation":
        await this.claimId(executor, write.value.id, "conversation");
        await executor.run("INSERT INTO conversations (id, owner_conversation_id, owner_task_id, record) VALUES (?, ?, ?, ?)", write.value.id, write.value.owner?.conversationId ?? null, write.value.owner?.taskId ?? null, encodeJson(write.value));
        break;
      case "entry":
        await this.claimId(executor, write.value.id, "entry");
        await executor.run("INSERT INTO entries (id, conversation_id, head, commit_seq, record) VALUES (?, ?, ?, ?, ?)", write.value.id, write.value.conversationId, write.value.head ?? null, seq, encodeJson(write.value));
        break;
      case "task":
        await this.claimId(executor, write.value.id, "task");
        await executor.run(`INSERT INTO tasks (id, conversation_id, kind, status, abort_requested, background, record)
						VALUES (?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT(id) DO UPDATE SET conversation_id = excluded.conversation_id, kind = excluded.kind,
						status = excluded.status, abort_requested = excluded.abort_requested,
						background = excluded.background, record = excluded.record`, write.value.id, write.value.conversationId, encodeIndexedString(write.value.kind), write.value.state.status, write.value.abortRequested ? 1 : 0, write.value.background ? 1 : 0, encodeJson(write.value));
        break;
      case "submission":
        await this.claimId(executor, write.value.id, "submission");
        await executor.run(`INSERT INTO submissions (id, conversation_id, request_id, status, record) VALUES (?, ?, ?, ?, ?)
						ON CONFLICT(id) DO UPDATE SET conversation_id = excluded.conversation_id,
						request_id = excluded.request_id, status = excluded.status, record = excluded.record`, write.value.id, write.value.conversationId, write.value.requestId === void 0 ? null : encodeIndexedString(write.value.requestId), write.value.status, encodeJson(write.value));
        break;
      case "document.create":
      case "document.copy":
      case "document.change":
      case "document.retire":
        break;
    }
  }
  async claimId(executor, id, table) {
    await executor.run("INSERT OR IGNORE INTO record_ids (id, record_type) VALUES (?, ?)", id, table);
  }
  async applyDocumentActions(executor, actions, seq) {
    for (const [id, action] of actions) {
      let content = action.content;
      if (action.copy !== void 0) {
        try {
          const stored = await this.materializeDocument(executor, action.copy.id, action.copy.at);
          if (stored === void 0)
            throw new Error(`Fork source document ${action.copy.id} cannot be read`);
          const create = action.create;
          if (stored.record.scope.kind !== "conversation" || create.scope.kind !== "conversation" || stored.record.kind !== create.kind || stored.record.key !== create.key || stored.record.history !== create.history || stored.record.fork !== create.fork) {
            throw new Error(`Fork source document ${action.copy.id} does not match the copied record`);
          }
          content = { kind: "base", version: stored.version, value: stored.value };
        } catch (error) {
          if (error instanceof StorageRejected)
            throw error;
          throw new StorageRejected(`Document copy ${id} was rejected`, { cause: error });
        }
      }
      let record;
      if (action.create !== void 0) {
        record = {
          ...action.create,
          createdAt: seq,
          ...action.retire ? { retiredAt: seq } : {}
        };
        const parts = addressParts(record);
        await this.claimId(executor, id, "document");
        await executor.run(`INSERT INTO documents
						(id, kind, family, key_value, scope_kind, owner_id, created_at, retired_at, record)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, parts.kind, parts.family, parts.keyValue, parts.scopeKind, parts.ownerId, seq, action.retire ? seq : null, encodeJson(record));
      } else {
        const row = await executor.get("SELECT record FROM documents WHERE id = ?", id);
        record = parseJson(row.record);
      }
      if (content !== void 0) {
        if (content.kind === "base" && isCurrentOnly(record)) {
          await executor.run("DELETE FROM document_revisions WHERE document_id = ?", id);
        }
        const encodedContent = content.kind === "base" ? encodeJson(content.value) : encodeJson(content.ops);
        await executor.run("INSERT INTO document_revisions (document_id, seq, kind, version, content) VALUES (?, ?, ?, ?, ?)", id, seq, content.kind, content.version, encodedContent);
      }
      if (action.retire) {
        if (action.create === void 0) {
          record = { ...record, retiredAt: seq };
          await executor.run("UPDATE documents SET retired_at = ?, record = ? WHERE id = ?", seq, encodeJson(record), id);
        }
        if (isCurrentOnly(record)) {
          await executor.run("DELETE FROM document_revisions WHERE document_id = ?", id);
        }
      }
    }
  }
  assertOpen() {
    if (this.closed)
      throw new Error("SqliteStorage is closed");
  }
};
export {
  CURRENT_SQLITE_SCHEMA_VERSION,
  SQLITE_MIGRATIONS,
  SqliteStorage,
  applySqliteMigrations
};
//# sourceMappingURL=@earendil-works_pi-durable_storage_sqlite.js.map
