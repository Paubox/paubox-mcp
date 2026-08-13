
// Mock environment variables for all tests
process.env.PAUBOX_API_KEY = 'test-key';

// Simple smoke test to ensure the test runner is working

test('smoke test', () => {
  expect(true).toBe(true);
});
