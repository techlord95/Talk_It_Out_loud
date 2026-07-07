/**
 * Aura Application Security & API Integration Test Suite
 *
 * This test suite makes real HTTP requests against the local development
 * server (http://localhost:3000) to verify API routing, validation rules,
 * rate limiting, origin checks, and error responses.
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';

async function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}${path}`;
    const parsedUrl = new URL(url);

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    if (options.body) {
      reqOptions.headers['Content-Length'] = Buffer.byteLength(options.body);
    }

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

const tests = [];
function addTest(name, fn) {
  tests.push({ name, fn });
}

// ── TEST CASES ────────────────────────────────────────────────────────

addTest('GET /api/livekit/token should be blocked or return 405/404/500', async () => {
  // Since we changed token route to POST, GET should not be handled or return error
  const res = await request('/api/livekit/token?room=test&username=user');
  console.log(`     Status: ${res.status}`);
  // In Next.js App Router, if GET is not defined, it returns 405 Method Not Allowed
  return res.status === 405;
});

addTest('POST /api/livekit/token with missing payload should return 400', async () => {
  const res = await request('/api/livekit/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  console.log(`     Status: ${res.status}, Body: ${res.body}`);
  const json = JSON.parse(res.body);
  return res.status === 400 && json.error && json.error.includes('required');
});

addTest('POST /api/livekit/token with invalid room characters should return 400', async () => {
  const res = await request('/api/livekit/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: 'invalid room!', username: 'user1' }),
  });
  console.log(`     Status: ${res.status}, Body: ${res.body}`);
  const json = JSON.parse(res.body);
  return res.status === 400 && json.error && json.error.includes('format');
});

addTest('POST /api/livekit/token with valid payload should return 500 when credentials are missing', async () => {
  const res = await request('/api/livekit/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: 'valid-room', username: 'valid-user' }),
  });
  console.log(`     Status: ${res.status}, Body: ${res.body}`);
  const json = JSON.parse(res.body);
  // Should return 500 since LiveKit API credentials aren't set in environment
  return res.status === 500 && json.error && json.error.includes('server-side error');
});

addTest('POST /api/translate with missing fields should return 400', async () => {
  const res = await request('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Audio: '' }),
  });
  console.log(`     Status: ${res.status}, Body: ${res.body}`);
  const json = JSON.parse(res.body);
  return res.status === 400 && json.error && json.error.includes('base64Audio');
});

addTest('POST /api/translate with invalid MIME type should return 400', async () => {
  const res = await request('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base64Audio: 'dGVzdA==',
      targetLanguage: 'es',
      mimeType: 'text/html', // HTML is not an audio mime type
    }),
  });
  console.log(`     Status: ${res.status}, Body: ${res.body}`);
  const json = JSON.parse(res.body);
  return res.status === 400 && json.error && json.error.includes('MIME');
});

addTest('POST /api/translate with content too large should return 413', async () => {
  // Create a massive payload header (> 5MB)
  const res = await request('/api/translate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': '6000000', // 6 MB
    },
    body: 'A'.repeat(6000000),
  });
  console.log(`     Status: ${res.status}, Body: ${res.body}`);
  return res.status === 413;
});

addTest('CSRF Origin Check: POST /api/translate from foreign origin should return 403', async () => {
  const res = await request('/api/translate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://malicious-attacker.com',
      'Host': 'localhost:3000',
    },
    body: JSON.stringify({
      base64Audio: 'dGVzdA==',
      targetLanguage: 'es',
      mimeType: 'audio/pcm;rate=16000',
    }),
  });
  console.log(`     Status: ${res.status}, Body: ${res.body}`);
  const json = JSON.parse(res.body);
  return res.status === 403 && json.error && json.error.includes('Cross-origin');
});

// ── RUNNER ────────────────────────────────────────────────────────────

async function runAll() {
  console.log('\n🚀 Starting Aura integration test suite...');
  console.log('--------------------------------------------------');

  let passedCount = 0;

  for (let i = 0; i < tests.length; i++) {
    const { name, fn } = tests[i];
    console.log(`[Test ${i + 1}/${tests.length}] ${name}`);
    try {
      const passed = await fn();
      if (passed) {
        console.log(`     👉 Result: PASS ✅\n`);
        passedCount++;
      } else {
        console.log(`     👉 Result: FAIL ❌\n`);
      }
    } catch (err) {
      console.log(`     👉 Result: ERROR 💥 (${err.message})\n`);
    }
  }

  console.log('--------------------------------------------------');
  console.log(`🏆 Test Run Complete: ${passedCount}/${tests.length} passed.`);
  if (passedCount === tests.length) {
    console.log('All tests passed successfully! 🎉');
  } else {
    console.log('Some tests failed. Check implementation.');
    process.exit(1);
  }
}

runAll().catch(console.error);
