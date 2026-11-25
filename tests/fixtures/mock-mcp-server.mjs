import readline from 'node:readline';

const TOOLS = [
  {
    name: 'search_issues',
    description: 'Search issues in the tracker by keyword and state.',
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], default: 'open' },
        limit: { type: 'integer', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_issue',
    description: 'Create a new issue in the project.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Issue title' },
        body: { type: 'string', description: 'Issue description' },
      },
      required: ['title'],
    },
  },
  {
    name: 'delete_issue',
    description: 'Permanently delete an issue by ID.',
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'Issue identifier' },
      },
      required: ['issueId'],
    },
  },
];

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

rl.on('line', (line) => {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }

  const { id, method, params } = req;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
        serverInfo: {
          name: 'mock-tracker-mcp',
          version: '1.0.0',
        },
        instructions: 'Use search_issues before modifying issues.',
      },
    });
    return;
  }

  if (method === 'notifications/initialized') {
    return;
  }

  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    return;
  }

  if (method === 'resources/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        resources: [
          {
            uri: 'tracker://projects/default',
            name: 'Default Project',
            description: 'Default tracker project metadata',
            mimeType: 'application/json',
          },
        ],
      },
    });
    return;
  }

  if (method === 'prompts/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        prompts: [
          {
            name: 'triage_bug',
            description: 'Triage a newly reported bug',
            arguments: [{ name: 'issueId', required: true }],
          },
        ],
      },
    });
    return;
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const args = params?.arguments ?? {};
    if (toolName === 'search_issues') {
      const items = [
        { id: 'ISS-1', title: `Match for ${args.query ?? 'all'}`, state: args.state ?? 'open', priority: 'high' },
        { id: 'ISS-2', title: `Secondary match for ${args.query ?? 'all'}`, state: args.state ?? 'open', priority: 'low' },
      ];
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(items) }],
          structuredContent: { items },
          isError: false,
        },
      });
      return;
    }

    if (toolName === 'create_issue') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify({ id: 'ISS-99', title: args.title, created: true }) }],
          isError: false,
        },
      });
      return;
    }

    if (toolName === 'delete_issue') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify({ deleted: args.issueId }) }],
          isError: false,
        },
      });
      return;
    }

    send({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        isError: true,
      },
    });
    return;
  }

  if (id !== undefined) {
    send({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }
});
