export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt provided' });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 8192, temperature: 0.4 },
        }),
      }
    );

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Gemini error' });

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
