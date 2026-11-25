import { describe, expect, it } from 'vitest';
import { formatOutput, toYaml } from '../src/core/output.js';
import { estimateMcpToolsTokens } from '../src/core/tokens.js';

describe('clispec v0.2 output & token formatting', () => {
  const sampleItems = [
    { id: '1', name: 'alpha', status: 'open', secretNote: 'ignore' },
    { id: '2', name: 'beta', status: 'closed', secretNote: 'ignore' },
    { id: '3', name: 'gamma', status: 'open', secretNote: 'ignore' },
  ];

  it('applies --fields projection and --limit with in-band truncated metadata', () => {
    const out = formatOutput(sampleItems, {
      format: 'json',
      fields: ['id', 'name'],
      limit: 2,
      pretty: false,
    });
    const parsed = JSON.parse(out);
    expect(parsed).toEqual({
      items: [
        { id: '1', name: 'alpha' },
        { id: '2', name: 'beta' },
      ],
      total: 3,
      offset: 0,
      limit: 2,
      truncated: true,
    });
  });

  it('supports TOON format and reduces tokens on uniform arrays compared to JSON', () => {
    const largeList = Array.from({ length: 25 }, (_, i) => ({
      id: `ISS-${i + 1}`,
      title: `Investigate latency spike in service ${i + 1}`,
      status: i % 2 === 0 ? 'open' : 'closed',
      owner: 'platform-team',
    }));
    const jsonOut = formatOutput({ items: largeList }, { format: 'json', pretty: false });
    const toonOut = formatOutput({ items: largeList }, { format: 'toon' });
    expect(toonOut.length).toBeLessThan(jsonOut.length);
    expect(toonOut).toContain('ISS-1');
  });

  it('emits valid NDJSON lines and YAML', () => {
    const ndjson = formatOutput(sampleItems, { format: 'ndjson', fields: ['id', 'name'] });
    const lines = ndjson.split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toEqual({ id: '1', name: 'alpha' });

    const yaml = toYaml({ name: 'test', items: ['a', 'b'] });
    expect(yaml).toContain('name: test');
    expect(yaml).toContain('- a');
  });

  it('estimates substantial upfront MCP tool token overhead', () => {
    const tokens = estimateMcpToolsTokens([
      {
        name: 'search_issues',
        description: 'Search issues across repositories with filters.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            state: { type: 'string', enum: ['open', 'closed'] },
          },
          required: ['query'],
        },
      },
    ]);
    expect(tokens).toBeGreaterThan(45);
  });
});
