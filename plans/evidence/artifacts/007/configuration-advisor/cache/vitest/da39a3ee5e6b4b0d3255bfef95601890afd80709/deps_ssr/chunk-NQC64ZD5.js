// ../../node_modules/.pnpm/@earendil-works+pi-durable@1.0.1_@aws-sdk+credential-provider-node@3.972.84_@modelconte_867545391487edcd36123475ad2fe1d0/node_modules/@earendil-works/pi-durable/dist/errors.js
var ReadAfterWrite = class extends Error {
  constructor(method) {
    super(`Tx.${method}() cannot read tables after the first table write`);
    this.name = "ReadAfterWrite";
  }
};
var StorageRejected = class extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "StorageRejected";
  }
};
var ConversationBusy = class extends Error {
  conversationId;
  constructor(conversationId) {
    super(`Conversation ${conversationId} is busy`);
    this.name = "ConversationBusy";
    this.conversationId = conversationId;
  }
};

// ../../node_modules/.pnpm/@earendil-works+pi-durable@1.0.1_@aws-sdk+credential-provider-node@3.972.84_@modelconte_867545391487edcd36123475ad2fe1d0/node_modules/@earendil-works/pi-durable/dist/ids.js
function idFromNumber(value) {
  return value;
}
function seqFromNumber(value) {
  return value;
}

export {
  ReadAfterWrite,
  StorageRejected,
  ConversationBusy,
  idFromNumber,
  seqFromNumber
};
//# sourceMappingURL=chunk-NQC64ZD5.js.map
