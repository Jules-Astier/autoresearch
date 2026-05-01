import { claudeCode, codex as sandcastleCodex, opencode, pi } from "@ai-hero/sandcastle";

export const DEFAULT_AGENT_PROVIDER = "codex";
export const DEFAULT_AGENT_MODEL = "gpt-5.4";
export const AGENT_ROLE_KEYS = ["researcher", "planner", "reviewer", "worker", "memoryKeeper"];

export function createAgentProvider(config) {
  const provider = normalizeAgentProvider(config.agentProvider ?? config.provider ?? DEFAULT_AGENT_PROVIDER);
  const model = stringOption(config.model, DEFAULT_AGENT_MODEL);
  if (provider === "codex") {
    return sandcastleCodex(model, { effort: config.effort, env: config.env });
  }
  if (provider === "claude-code" || provider === "claude") {
    return claudeCode(model, { effort: config.effort, env: config.env });
  }
  if (provider === "opencode") {
    return opencode(model, { env: config.env });
  }
  if (provider === "pi") {
    return pi(model, { env: config.env });
  }
  throw new Error(`Unsupported agent provider: ${provider}`);
}

export function resolveAgentRoleConfig({
  role,
  sessionAgent,
  sandboxAgent,
  args = {},
  providerOverrides = [],
  modelOverrides = [],
  effortOverrides = [],
  providerFallbacks = [],
  modelFallbacks = [],
  effortFallbacks = [],
  defaultProvider = DEFAULT_AGENT_PROVIDER,
  defaultModel = DEFAULT_AGENT_MODEL
}) {
  const roleKey = normalizeRoleKey(role);
  const envPrefix = envRolePrefix(roleKey);
  const sources = agentRoleConfigSources(sessionAgent, sandboxAgent, roleKey);
  const highPrecedenceSources = [...sources].reverse();
  const provider = normalizeAgentProvider(
    stringOption(
      args[`${roleKey}AgentProvider`],
      args[`${roleKey}Provider`],
      process.env[`AUTORESEARCH_${envPrefix}_AGENT_PROVIDER`],
      process.env[`AUTORESEARCH_${envPrefix}_PROVIDER`],
      ...providerOverrides,
      ...highPrecedenceSources.map((source) => source.provider),
      ...providerFallbacks,
      defaultProvider
    )
  );
  return {
    role: roleKey,
    agentProvider: provider,
    provider,
    model: stringOption(
      args[`${roleKey}AgentModel`],
      args[`${roleKey}Model`],
      process.env[`AUTORESEARCH_${envPrefix}_AGENT_MODEL`],
      process.env[`AUTORESEARCH_${envPrefix}_MODEL`],
      ...modelOverrides,
      ...highPrecedenceSources.map((source) => source.model),
      ...modelFallbacks,
      defaultModel
    ),
    effort: optionalStringValue(
      args[`${roleKey}AgentEffort`],
      args[`${roleKey}Effort`],
      process.env[`AUTORESEARCH_${envPrefix}_AGENT_EFFORT`],
      process.env[`AUTORESEARCH_${envPrefix}_EFFORT`],
      ...effortOverrides,
      ...highPrecedenceSources.map((source) => source.effort),
      ...effortFallbacks
    ),
    env: resolveAgentEnv(...sources),
    rawSources: sources
  };
}

export function resolveAgentEnv(...configs) {
  return configs.reduce((env, config) => ({
    ...env,
    ...envRecord(config?.env),
    ...envVars(config?.envVars)
  }), {});
}

export function normalizeAgentProvider(value) {
  const provider = optionalStringValue(value)?.toLowerCase();
  if (
    provider !== "codex" &&
    provider !== "claude-code" &&
    provider !== "claude" &&
    provider !== "opencode" &&
    provider !== "pi"
  ) {
    throw new Error("agent.provider must be codex, claude-code, opencode, or pi");
  }
  return provider;
}

export function stringOption(...values) {
  for (const value of values) {
    const option = optionalStringValue(value);
    if (option !== undefined) return option;
  }
  return undefined;
}

export function optionalStringValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return undefined;
}

function agentRoleConfigSources(sessionAgent, sandboxAgent, role) {
  const sessionBase = baseAgentConfig(sessionAgent);
  const sandboxBase = baseAgentConfig(sandboxAgent);
  return [
    sessionBase,
    sandboxBase,
    roleAgentConfig(sessionAgent, role),
    roleAgentConfig(sandboxAgent, role)
  ].filter(isPlainObject);
}

function baseAgentConfig(value) {
  if (!isPlainObject(value)) return {};
  const base = { ...value };
  for (const key of AGENT_ROLE_KEYS) {
    delete base[key];
  }
  return base;
}

function roleAgentConfig(value, role) {
  if (!isPlainObject(value)) return {};
  return isPlainObject(value[role]) ? value[role] : {};
}

function normalizeRoleKey(value) {
  const text = String(value ?? "").trim();
  if (text === "memory-keeper" || text === "memory_keeper") return "memoryKeeper";
  return text;
}

function envRolePrefix(role) {
  return role.replace(/[A-Z]/g, (char) => `_${char}`).toUpperCase();
}

function envVars(value) {
  if (!Array.isArray(value)) return {};
  const env = {};
  for (const name of value) {
    const key = String(name || "").trim();
    if (!key) continue;
    const envValue = process.env[key];
    if (envValue === undefined) {
      throw new Error(`Missing environment variable requested by agent config: ${key}`);
    }
    env[key] = envValue;
  }
  return env;
}

function envRecord(value) {
  if (!isPlainObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => key && item !== undefined && item !== null)
      .map(([key, item]) => [key, String(item)])
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
