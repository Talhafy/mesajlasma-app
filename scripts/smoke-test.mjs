const apiBaseUrl = (process.env.SMOKE_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const webBaseUrl = (process.env.SMOKE_WEB_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const attempts = Number(process.env.SMOKE_ATTEMPTS || 30);
const retryDelayMs = Number(process.env.SMOKE_RETRY_DELAY_MS || 1000);

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const fetchWithRetry = async (url) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok) return response;
      lastError = new Error(`${url} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await wait(retryDelayMs);
  }
  throw lastError;
};

const healthResponse = await fetchWithRetry(`${apiBaseUrl}/api/v1/health/ready`);
const health = await healthResponse.json();
if (health.status !== 'ready' || !health.timestamp) {
  throw new Error('API health payload is invalid.');
}

const webResponse = await fetchWithRetry(webBaseUrl);
const html = await webResponse.text();
if (!html.includes('<div id="root"></div>')) {
  throw new Error('Frontend root document is invalid.');
}

process.stdout.write(`Smoke test passed: ${apiBaseUrl} and ${webBaseUrl}\n`);
