
import { GET } from '../app/api/mcp/route';

describe('/api/mcp handler', () => {
  it('should export GET handler as a function', () => {
    expect(typeof GET).toBe('function');
  });
});
