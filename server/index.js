const express = require('express');
require('dotenv').config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const app = express();
app.use(express.json({ limit: '2mb' }));

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = process.env.ANTHROPIC_VERSION || '2023-06-01';

app.post('/api/anthropic/messages', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      message: 'Missing ANTHROPIC_API_KEY server environment variable',
    });
  }

  try {
    const upstreamResponse = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(req.body),
    });

    const text = await upstreamResponse.text();

    // Try to parse JSON; if it fails, return the raw text for debugging.
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { message: text };
    }

    return res.status(upstreamResponse.status).json(json);
  } catch (err) {
    console.error('Anthropic proxy error:', err);
    return res.status(502).json({ message: 'Failed to reach Anthropic API' });
  }
});

const port = Number(process.env.PORT || 5000);
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
