import Resolver from '@forge/resolver';

const resolver = new Resolver();

const BACKEND_URL = 'https://api.spec2jira.com';

resolver.define('getText', (req) => {
  return 'Hello, world!';
});

resolver.define('testBackend', async (req) => {
  try {
    const { pageId, spaceKey } = req.payload;
    const response = await fetch(`${BACKEND_URL}/health`, {
      method: 'GET',
    });
    const data = await response.json();
    return {
      success: true,
      status: response.status,
      pageContext: { pageId, spaceKey },
      backend: data
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

export const handler = resolver.getDefinitions();
