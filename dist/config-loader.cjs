var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/lib/config.js
var config_exports = {};
__export(config_exports, {
  buildSyntheticConfig: () => buildSyntheticConfig,
  findConfigPath: () => findConfigPath,
  loadConfig: () => loadConfig,
  parseIntegerInput: () => parseIntegerInput,
  parseUrlsInput: () => parseUrlsInput
});
module.exports = __toCommonJS(config_exports);
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var import_node_url = require("node:url");
var DEFAULT_CONFIG_NAMES = [".pa11yci", ".pa11yci.json", ".pa11yci.js", ".pa11yci.cjs"];
async function loadConfig({ configPath, config }, warn = console.warn) {
  if (configPath) {
    config = /\.(cjs|mjs|js)$/.test(configPath) ? await (await import((0, import_node_url.pathToFileURL)(configPath).href)).default : JSON.parse(import_node_fs.default.readFileSync(configPath, "utf8"));
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("pa11y-ci config must export an object");
  }
  const defaults = config.defaults ?? {};
  if (typeof defaults !== "object" || Array.isArray(defaults)) {
    throw new Error("pa11y-ci config defaults must be an object");
  }
  const urls = config.urls ?? [];
  if (!Array.isArray(urls)) {
    throw new Error("pa11y-ci config urls must be an array");
  }
  const seen = /* @__PURE__ */ new Set();
  for (const entry of urls) {
    const url = typeof entry === "string" ? entry : entry?.url;
    if (typeof url !== "string" || !url.trim()) {
      throw new Error("each pa11y-ci config URL must be a non-empty string or an object with a url");
    }
    if (seen.has(url)) {
      throw new Error(`duplicate URL "${url}": use separate action steps for different scenarios of the same URL`);
    }
    seen.add(url);
  }
  const options = [config, defaults, ...urls.filter((url) => typeof url === "object")];
  if (options.some((options2) => options2.threshold !== void 0 && options2.threshold !== 0)) {
    warn("Config thresholds are overridden for this action run so all issues remain in the report. The original config is unchanged; use the action threshold input to allow issues.");
  }
  return {
    ...config,
    threshold: 0,
    defaults: { ...defaults, threshold: 0, reporters: [] },
    urls: urls.map((url) => typeof url === "object" ? { ...url, threshold: 0 } : url)
  };
}
function findConfigPath(configInput, workingDirectory) {
  if (configInput) {
    const resolved = import_node_path.default.resolve(workingDirectory, configInput);
    if (!import_node_fs.default.existsSync(resolved)) {
      throw new Error(`config input was set to "${configInput}", but no file exists at ${resolved}`);
    }
    return resolved;
  }
  for (const name of DEFAULT_CONFIG_NAMES) {
    const candidate = import_node_path.default.join(workingDirectory, name);
    if (import_node_fs.default.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}
function buildSyntheticConfig({ urls, sitemap, standard, concurrency }) {
  if (!urls.length && !sitemap) {
    throw new Error("no config file was found and neither `urls` nor `sitemap` was provided");
  }
  return {
    defaults: {
      standard,
      concurrency,
      chromeLaunchConfig: {
        args: ["--no-sandbox"]
      }
    },
    urls
  };
}
function parseIntegerInput(name, value, { min }) {
  const trimmed = value.trim();
  const parsed = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < min) {
    throw new Error(`\`${name}\` must be a whole number of at least ${min}, got "${value}"`);
  }
  return parsed;
}
function parseUrlsInput(urlsInput) {
  return urlsInput.split("\n").map((url) => url.trim()).filter(Boolean);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildSyntheticConfig,
  findConfigPath,
  loadConfig,
  parseIntegerInput,
  parseUrlsInput
});
