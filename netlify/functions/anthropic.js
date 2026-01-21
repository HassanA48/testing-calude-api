require('dotenv').config();

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ message: 'Method not allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ message: 'Missing ANTHROPIC_API_KEY environment variable' }) };
  }

  const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
  const ANTHROPIC_VERSION = process.env.ANTHROPIC_VERSION || '2023-06-01';

  try {
    const upstreamResponse = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: event.body,
    });

    const text = await upstreamResponse.text();

    return {
      statusCode: upstreamResponse.status,
      body: text,
    };
  } catch (err) {
    console.error('Anthropic proxy error:', err);
    return { statusCode: 502, body: JSON.stringify({ message: 'Failed to reach Anthropic API' }) };
  }
};
