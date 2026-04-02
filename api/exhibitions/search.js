const { sendJson } = require('../_lib/http');

function decodeHtml(text = '') {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function domainLabel(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (_) {
    return 'web';
  }
}

function inferCity(text = '') {
  const cities = ['Mumbai','Delhi','Bangalore','Bengaluru','Hyderabad','Pune','Jaipur','Ahmedabad','Kolkata','Chennai','Goa'];
  const hit = cities.find(city => text.toLowerCase().includes(city.toLowerCase()));
  return hit || '';
}

function parseDuckDuckGo(html = '') {
  const results = [];
  const regex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = regex.exec(html))) {
    const url = decodeHtml(match[1]);
    const title = decodeHtml(match[2]);
    const snippet = decodeHtml(match[3]);
    if (!url || !title) continue;
    results.push({
      title,
      url,
      snippet,
      source: domainLabel(url),
      city: inferCity(`${title} ${snippet}`),
    });
  }
  return results;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

  const market = String(req.query.market || 'India').trim() || 'India';
  const queries = [
    `${market} D2C brand exhibition 2026`,
    `${market} fashion lifestyle exhibition 2026`,
    `${market} pop up market fashion brands 2026`,
    `${market} retail expo brand activation 2026`,
    `${market} event for direct-to-consumer brands 2026`,
  ];

  try {
    const batches = await Promise.all(queries.map(async q => {
      const resp = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SerafinaOS/1.0; +https://serafina-os.vercel.app)'
        }
      });
      if (!resp.ok) throw new Error(`Search HTTP ${resp.status}`);
      const html = await resp.text();
      return parseDuckDuckGo(html);
    }));

    const seen = new Set();
    const preferredDomains = ['10times.com', 'allevents.in', 'eventbrite.com', 'bookmyshow.com', 'insider.in'];
    const scored = batches.flat().filter(item => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    }).map(item => {
      const hay = `${item.title} ${item.snippet}`.toLowerCase();
      const score =
        (preferredDomains.includes(item.source) ? 5 : 0) +
        (hay.includes('d2c') ? 4 : 0) +
        (hay.includes('brand') ? 3 : 0) +
        (hay.includes('fashion') || hay.includes('lifestyle') ? 3 : 0) +
        (hay.includes('retail') || hay.includes('expo') ? 2 : 0) +
        (hay.includes('activation') ? 2 : 0) +
        (hay.includes('pop up') || hay.includes('popup') || hay.includes('pop-up') ? 2 : 0);
      return { ...item, score };
    }).sort((a, b) => b.score - a.score).slice(0, 12);

    sendJson(res, 200, { ok: true, market, results: scored });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
};
