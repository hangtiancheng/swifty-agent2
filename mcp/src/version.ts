// Single source of truth for the server version, surfaced at MCP initialize.
// mcp/ has no package.json of its own (it is part of the root package), so the
// version lives here — same contract as the Python original's app/version.py.

export const version = "0.0.1";
