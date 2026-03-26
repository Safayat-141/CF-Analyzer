export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { contestId, submissionId } = req.body;
  if (!contestId || !submissionId) return res.status(400).json({ error: 'Missing params' });

  try {
    const url = `https://codeforces.com/contest/${contestId}/submission/${submissionId}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    if (!response.ok) return res.status(404).json({ error: 'Submission page not found' });

    const html = await response.text();

    // CF stores source code in <pre id="program-source-text">
    const match = html.match(/id="program-source-text"[^>]*>([\s\S]*?)<\/pre>/);
    if (!match) return res.status(404).json({ error: 'Could not extract code' });

    const code = match[1]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, '') // strip any html tags
      .trim();

    return res.status(200).json({ code: code.substring(0, 2500) });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}