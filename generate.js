exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' }, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'Method not allowed' };
  }

  try {
    const incoming = JSON.parse(event.body);
    const API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!API_KEY) {
      return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: { message: 'API key not configured' } }) };
    }

    const requestBody = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: incoming.messages
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(requestBody)
    });

    const text = await response.text();
    console.log('Anthropic status:', response.status, 'response:', text.substring(0, 300));

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      // If Anthropic's response isn't valid JSON, just pass it through as before.
      return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: text };
    }

    // Only attempt verification if this looks like a successful Greenprint response
    // (has content, and the request included a state — passed from index.html as incoming.usState)
    const rawText = data.content && data.content[0] ? data.content[0].text : '';
    const usState = incoming.usState || null;

    if (rawText && usState) {
      const verified = await verifyPlants(rawText, usState);
      // Stitch the verification notes back into the text the front end already parses,
      // by appending a VERIFICATION block it can read separately if it chooses to.
      data.content[0].text = rawText + '\n\nVERIFICATION:\n' + JSON.stringify(verified);
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };

  } catch (err) {
    console.log('Error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: { message: err.message } })
    };
  }
};

// Pulls scientific names out of Claude's "RECOMMENDED NATIVE PLANTS" block
// and checks each one against GBIF's live occurrence API for the given US state.
async function verifyPlants(text, usState) {
  const match = text.match(/RECOMMENDED NATIVE PLANTS:\n([\s\S]*?)(?=PLANTING TIMELINE:|$)/);
  if (!match) return [];

  const lines = match[1].trim().split('\n').filter(l => l.trim().startsWith('-'));
  const results = [];

  for (const line of lines) {
    const sciMatch = line.match(/\(([^)]+)\)/);
    const commonName = line.replace(/^-\s*/, '').split('(')[0].trim();
    if (!sciMatch) {
      results.push({ name: commonName, scientificName: null, verified: false, reason: 'no scientific name provided' });
      continue;
    }
    const scientificName = sciMatch[1].trim();

    try {
      // Step 1: resolve the scientific name to a GBIF taxon key
      const matchResp = await fetch('https://api.gbif.org/v1/species/match?name=' + encodeURIComponent(scientificName));
      const matchData = await matchResp.json();

      if (!matchData.usageKey) {
        results.push({ name: commonName, scientificName, verified: false, reason: 'species not found in GBIF' });
        continue;
      }

      // Step 2: check for real occurrence records in this US state
      const occResp = await fetch(
        'https://api.gbif.org/v1/occurrence/search?taxonKey=' + matchData.usageKey +
        '&country=US&stateProvince=' + encodeURIComponent(usState) + '&limit=1'
      );
      const occData = await occResp.json();
      const hasOccurrence = occData.count && occData.count > 0;

      results.push({
        name: commonName,
        scientificName,
        verified: hasOccurrence,
        reason: hasOccurrence ? 'occurrence records found in ' + usState : 'no occurrence records found in ' + usState + ' (may still be regionally appropriate; not confirmed)'
      });

    } catch (e) {
      results.push({ name: commonName, scientificName, verified: false, reason: 'verification check failed: ' + e.message });
    }
  }

  return results;
}
