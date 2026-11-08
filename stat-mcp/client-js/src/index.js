import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const DEFAULT_ENDPOINT = "http://127.0.0.1:8010/mcp";

function toBase64(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes.toString("base64");
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes).toString("base64");
  if (ArrayBuffer.isView(bytes)) {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  }
  throw new TypeError("file.bytes must be a Buffer, Uint8Array, or ArrayBuffer");
}

function decodeToolResult(name, result) {
  if (result.isError) {
    const message = result.content?.map((part) => part.text ?? "").filter(Boolean).join("\n");
    throw new Error(`stat-mcp tool ${name} failed${message ? `: ${message}` : ""}`);
  }
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content?.find((part) => part.type === "text")?.text;
  if (text === undefined) return result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Server-side MCP client. Keep uploaded donor files and API credentials out of browsers. */
export class StatMcpClient {
  constructor({ endpoint = process.env.STAT_MCP_URL ?? DEFAULT_ENDPOINT, name = "main-server" } = {}) {
    this.endpoint = new URL(endpoint);
    this.client = new Client({ name, version: "0.1.0" });
    this.transport = new StreamableHTTPClientTransport(this.endpoint);
    this.connected = false;
  }

  async connect() {
    if (!this.connected) {
      await this.client.connect(this.transport);
      this.connected = true;
    }
    return this;
  }

  async close() {
    if (this.connected) {
      await this.client.close();
      this.connected = false;
    }
  }

  async callTool(name, args = {}) {
    if (!this.connected) throw new Error("Call connect() before using stat-mcp tools.");
    const result = await this.client.callTool({ name, arguments: args });
    return decodeToolResult(name, result);
  }

  async importFile({ name, bytes }) {
    return this.callTool("import_donor_data", {
      source_name: name,
      content_base64: toBase64(bytes),
    });
  }

  async importFiles(files) {
    if (!Array.isArray(files) || files.length < 1 || files.length > 20) {
      throw new RangeError("files must contain between 1 and 20 items");
    }
    return this.callTool("import_donor_files", {
      files: files.map(({ name, bytes }) => ({ name, content: toBase64(bytes) })),
    });
  }

  getTransactions(datasetId, { offset = 0, limit = 50 } = {}) {
    return this.callTool("get_donor_transactions", {
      dataset_id: datasetId,
      offset,
      limit,
    });
  }

  getPeople(datasetId, { offset = 0, limit = 20 } = {}) {
    return this.callTool("get_donor_records", {
      dataset_id: datasetId,
      offset,
      limit,
    });
  }

  summarize(datasetId) {
    return this.callTool("summarize_donor_dataset", { dataset_id: datasetId });
  }

  suggestDuplicates(datasetId, { threshold = 0.65 } = {}) {
    return this.callTool("suggest_duplicate_donors", {
      dataset_id: datasetId,
      threshold,
    });
  }

  getSuggestedFields() {
    return this.callTool("get_suggested_donor_fields");
  }

  getSuggestedCriteria() {
    return this.callTool("get_suggested_scoring_criteria");
  }

  scorePerson(datasetId, recordIndex, criteria, opportunityContext) {
    return this.callTool("score_donor", {
      dataset_id: datasetId,
      record_index: recordIndex,
      criteria,
      opportunity_context: opportunityContext,
    });
  }

  scorePeople(datasetId, criteria, { maxRecords = 10, opportunityContext } = {}) {
    return this.callTool("score_donor_dataset", {
      dataset_id: datasetId,
      criteria,
      max_records: maxRecords,
      opportunity_context: opportunityContext,
    });
  }
}

export { DEFAULT_ENDPOINT };
