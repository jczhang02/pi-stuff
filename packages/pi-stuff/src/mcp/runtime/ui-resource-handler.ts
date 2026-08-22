import { isJsonInputObject, type JsonInputObject, type JsonInputValue } from "../../shared/json-value.js";
import { isRuntimeBoolean } from "../../shared/runtime-type.js";
import { isRuntimeObject, isRuntimeString } from "../../shared/runtime-type.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/app-bridge";
import { UrlElicitationRequiredError, type ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { ResourceFetchError, ResourceParseError } from "./errors.ts";
import { logger } from "./logger.ts";
import { SessionRecoveryAuthRequiredError, withSessionRecovery, type SessionRecoveryDeps } from "./session-recovery.ts";
import type { McpServerManager } from "./server-manager.ts";
import { isServerDisabled, type McpConfig, type UiResourceContent, type UiResourceCsp, type UiResourceMeta } from "./types.ts";

interface ReadUiResourceOptions {
  config?: McpConfig;
  signal?: AbortSignal;
  onNeedsAuth?: SessionRecoveryDeps["onNeedsAuth"];
}

export class UiResourceHandler {
  private log = logger.child({ component: "UiResourceHandler" });

  constructor(private manager: McpServerManager, private config?: McpConfig) {}

  async readUiResource(serverName: string, uri: string, options: ReadUiResourceOptions = {}): Promise<UiResourceContent> {
    const log = this.log.child({ server: serverName, uri });

    if (!uri.startsWith("ui://")) {
      throw new ResourceParseError(uri, "URI must start with ui://", { server: serverName });
    }

    log.debug("Fetching UI resource");

    let result: ReadResourceResult;
    try {
      const config = options.config ?? this.config;
      if (config && isServerDisabled(config.mcpServers[serverName])) {
        throw new Error(`MCP server "${serverName}" is disabled`);
      }
      if (config) {
        this.manager.touch(serverName);
        this.manager.incrementInFlight(serverName);
        try {
          result = await withSessionRecovery(
            { manager: this.manager, config, signal: options.signal, onNeedsAuth: options.onNeedsAuth },
            serverName,
            (connection) => connection.client.readResource({ uri }, this.manager.getRequestOptions(serverName, options.signal)),
          );
        } finally {
          this.manager.decrementInFlight(serverName);
          this.manager.touch(serverName);
        }
      } else {
        result = await this.manager.readResource(serverName, uri, options.signal);
      }
    } catch (error) {
      if (error instanceof UrlElicitationRequiredError || error instanceof SessionRecoveryAuthRequiredError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      log.error("Failed to read resource", error instanceof Error ? error : undefined);
      throw new ResourceFetchError(uri, message, {
        server: serverName,
        cause: error instanceof Error ? error : undefined,
      });
    }

    const content = selectContent(result, uri);
    const mimeType = content.mimeType;

    if (mimeType && !isHtmlMimeType(mimeType)) {
      log.warn("Unsupported MIME type", { mimeType });
      throw new ResourceParseError(
        uri,
        `unsupported MIME type "${mimeType}" (expected text/html or ${RESOURCE_MIME_TYPE})`,
        { server: serverName, mimeType }
      );
    }

    const html = toHtml(content);
    if (!html.trim()) {
      log.warn("Resource content is empty");
      throw new ResourceParseError(uri, "content is empty", { server: serverName });
    }

    const contentMeta = extractUiMeta(content._meta);
    const listMeta = extractUiMeta(this.getListResourceMeta(serverName, uri));

    log.debug("Resource loaded successfully", { 
      contentLength: html.length,
      hasCsp: !!contentMeta.csp || !!listMeta.csp,
    });

    return {
      uri: content.uri ?? uri,
      html,
      mimeType: mimeType ?? RESOURCE_MIME_TYPE,
      meta: {
        csp: contentMeta.csp ?? listMeta.csp,
        permissions: contentMeta.permissions ?? listMeta.permissions,
        domain: contentMeta.domain ?? listMeta.domain,
        prefersBorder: contentMeta.prefersBorder ?? listMeta.prefersBorder,
      },
    };
  }

  private getListResourceMeta(serverName: string, uri: string): JsonInputObject | undefined {
    const connection = this.manager.getConnection(serverName);
    if (!connection?.resources?.length) return undefined;
	    const resource = connection.resources.find((entry) => entry.uri === uri);
	    return isJsonInputObject(resource?._meta) ? resource._meta : undefined;
  }
}

function selectContent(result: ReadResourceResult, preferredUri: string): ReadResourceResult["contents"][number] {
	  const contents = result.contents ?? [];
  if (contents.length === 0) {
    throw new Error(`No contents returned for UI resource: ${preferredUri}`);
  }

  const byUri = contents.find((content) => content.uri === preferredUri);
  if (byUri) return byUri;

  const byHtmlMime = contents.find(
    (content) => content.mimeType && isHtmlMimeType(content.mimeType)
  );
  if (byHtmlMime) return byHtmlMime;

  return contents[0];
}

function isHtmlMimeType(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase();
  return normalized.startsWith("text/html") || normalized === RESOURCE_MIME_TYPE.toLowerCase();
}

function toHtml(content: ReadResourceResult["contents"][number]): string {
	  if ("text" in content && isRuntimeString(content.text)) {
    return content.text;
  }

	  if ("blob" in content && isRuntimeString(content.blob)) {
    return Buffer.from(content.blob, "base64").toString("utf-8");
  }

  throw new Error(`UI resource ${content.uri ?? "(unknown)"} did not include text or blob content`);
}

const OPENAI_CSP_FIELD_MAPPINGS = [
  ["resource_domains", "resourceDomains"],
  ["connect_domains", "connectDomains"],
  ["frame_domains", "frameDomains"],
] as const;

const UI_CSP_DOMAIN_FIELDS: readonly (keyof UiResourceCsp)[] = [
  "resourceDomains",
  "connectDomains",
  "frameDomains",
  "baseUriDomains",
];
const UI_PERMISSION_FIELDS = ["camera", "microphone", "geolocation", "clipboardWrite"] as const;

function extractUiMeta(meta: JsonInputObject | undefined): UiResourceMeta {
  if (!meta || !isRuntimeObject(meta)) return {};

  const ui = isRecord(meta.ui) ? meta.ui : undefined;
  const out: UiResourceMeta = {};
  const openAiCsp = hasOwnProperty(meta, "openai/widgetCSP")
    ? normalizeOpenAiWidgetCsp(meta["openai/widgetCSP"])
    : undefined;
  const hasStandardCsp = !!ui && hasOwnProperty(ui, "csp");
  const standardCspValue = hasStandardCsp ? ui.csp : undefined;

  if (hasStandardCsp && !isRecord(standardCspValue)) {
    // A declared canonical container takes precedence even when malformed.
    out.csp = {};
  } else {
    const standardCsp = hasStandardCsp
      ? normalizeUiResourceCsp(standardCspValue)
      : undefined;
    if (openAiCsp || standardCsp) {
      out.csp = { ...openAiCsp, ...standardCsp };
      if (isRecord(standardCspValue)) {
        for (const [, standardField] of OPENAI_CSP_FIELD_MAPPINGS) {
          if (hasOwnProperty(standardCspValue, standardField) && !copyStringArray(standardCspValue[standardField])) {
            delete out.csp[standardField];
          }
        }
      }
    }
  }

	  const permissions = normalizeUiResourcePermissions(ui?.permissions);
	  if (permissions) out.permissions = permissions;
  if (ui && isRuntimeString(ui.domain)) {
    out.domain = ui.domain;
  }
  if (ui && isRuntimeBoolean(ui.prefersBorder)) {
    out.prefersBorder = ui.prefersBorder;
  }

  return out;
}

function normalizeUiResourcePermissions(value: JsonInputValue): NonNullable<UiResourceMeta["permissions"]> | undefined {
	if (!isRecord(value)) return undefined;
	const permissions: NonNullable<UiResourceMeta["permissions"]> = {};
	for (const field of UI_PERMISSION_FIELDS) {
		if (isRecord(value[field])) permissions[field] = {};
	}
	return permissions;
}

function normalizeUiResourceCsp(value: JsonInputValue): UiResourceCsp {
  if (!isRecord(value)) return {};

  const csp: UiResourceCsp = {};
  for (const field of UI_CSP_DOMAIN_FIELDS) {
    const domains = copyStringArray(value[field]);
    if (domains) csp[field] = domains;
  }
  return csp;
}

function normalizeOpenAiWidgetCsp(value: JsonInputValue): UiResourceCsp {
  if (!isRecord(value)) return {};

  const csp: UiResourceCsp = {};
  for (const [sourceField, targetField] of OPENAI_CSP_FIELD_MAPPINGS) {
    const domains = copyStringArray(value[sourceField]);
    if (domains) csp[targetField] = domains;
  }
  return csp;
}

function copyStringArray(value: JsonInputValue): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => isRuntimeString(entry))
    ? [...value]
    : undefined;
}

function hasOwnProperty(record: JsonInputObject, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, property);
}

function isRecord(value: JsonInputValue): value is JsonInputObject {
  return isRuntimeObject(value) && value !== null && !Array.isArray(value);
}
