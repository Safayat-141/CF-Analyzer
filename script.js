// ═══════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════

// API key is stored securely in Vercel environment variables
const RATING_BUCKETS = [800,900,1000,1100,1200,1300,1400,1500,1600,1700,1800,1900,2000];

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
function setLoader(msg) { document.getElementById('loaderText').textContent = msg; }
function showError(msg) {
  const box = document.getElementById('errorBox');
  box.textContent = "✗ " + msg;
  show('errorBox');
}
function ratingColor(r) {
  if (!r) return "#888";
  if (r >= 2400) return "#ff3333";
  if (r >= 2100) return "#ff8c00";
  if (r >= 1900) return "#aa00aa";
  if (r >= 1600) return "#0080ff";
  if (r >= 1400) return "#03a89e";
  if (r >= 1200) return "#008000";
  return "#888888";
}

// ═══════════════════════════════════════════
// CODEFORCES API
// ═══════════════════════════════════════════

async function fetchAll(handle) {
  const base = "https://codeforces.com/api/";
  const [s, r, u] = await Promise.all([
    fetch(`${base}user.status?handle=${handle}&from=1&count=10000`),
    fetch(`${base}user.rating?handle=${handle}`),
    fetch(`${base}user.info?handles=${handle}`),
  ]);
  const [sd, rd, ud] = await Promise.all([s.json(), r.json(), u.json()]);
  if (ud.status !== "OK") throw new Error("Handle not found. Check spelling.");
  return {
    submissions:   sd.status === "OK" ? sd.result : [],
    ratingHistory: rd.status === "OK" ? rd.result : [],
    userInfo:      ud.result[0],
  };
}

// ═══════════════════════════════════════════
// DATA PROCESSING
// ═══════════════════════════════════════════

function processData(submissions, ratingHistory) {
  const seen = new Set();
  const unique = [];
  for (const s of submissions) {
    if (s.verdict !== "OK") continue;
    const key = `${s.problem.contestId}-${s.problem.index}`;
    if (!seen.has(key)) { seen.add(key); unique.push(s); }
  }
  const rated = unique.filter(s => s.problem.rating);

  const bucketMap = {};
  for (const b of RATING_BUCKETS) bucketMap[b] = [];
  for (const s of rated) {
    const b = Math.floor(s.problem.rating / 100) * 100;
    if (bucketMap[b]) bucketMap[b].push({ name: s.problem.name, rating: s.problem.rating, tags: s.problem.tags || [] });
  }

  const tagMap = {};
  for (const [, probs] of Object.entries(bucketMap)) {
    for (const p of probs) {
      for (const tag of p.tags) {
        if (!tagMap[tag]) tagMap[tag] = { total: 0 };
        tagMap[tag].total++;
      }
    }
  }

  let comfortBucket = 800;
  for (const b of RATING_BUCKETS) {
    if ((bucketMap[b] || []).length >= 5) comfortBucket = b;
  }
  const ci = RATING_BUCKETS.indexOf(comfortBucket);
  const nextBucket     = RATING_BUCKETS[ci + 1] || comfortBucket + 100;
  const nextNextBucket = RATING_BUCKETS[ci + 2] || nextBucket + 100;

  const tagFreqNext = {};
  for (const p of (bucketMap[nextBucket] || [])) {
    for (const t of p.tags) tagFreqNext[t] = (tagFreqNext[t] || 0) + 1;
  }
  const tagGaps = Object.entries(tagFreqNext)
    .filter(([tag, freq]) => freq >= 2 && (!tagMap[tag] || tagMap[tag].total < 3))
    .map(([tag]) => tag);

  const recentSubs = submissions
    .filter(s => s.verdict === "OK" && s.problem.rating)
    .slice(0, 8)
    .map(s => ({
      problem: s.problem.name,
      rating:  s.problem.rating,
      tags:    s.problem.tags || [],
      lang:    s.programmingLanguage || "unknown",
      timeMs:  s.timeConsumedMillis,
    }));

  let contestStats = null;
  if (ratingHistory.length > 0) {
    const ratings = ratingHistory.map(c => c.newRating);
    let wins = 0, losses = 0;
    for (const c of ratingHistory) { if (c.newRating - c.oldRating > 0) wins++; else losses++; }
    contestStats = {
      totalContests:    ratingHistory.length,
      currentRating:    ratings[ratings.length - 1],
      peakRating:       Math.max(...ratings),
      positiveContests: wins,
      negativeContests: losses,
      recentContests:   ratingHistory.slice(-5).reverse().map(c => ({
        name: c.contestName, delta: c.newRating - c.oldRating, rank: c.rank, rating: c.newRating,
      })),
    };
  }

  return { totalSolved: rated.length, bucketMap, tagMap, comfortBucket, nextBucket, nextNextBucket, tagGaps, contestStats, recentSubs };
}

// ═══════════════════════════════════════════
// BUILD PROMPT
// Uses [TAG] / [TAG_END] delimiters — Gemini
// will never reformat these, making parsing
// 100% reliable regardless of markdown output.
// ═══════════════════════════════════════════

function buildPrompt(userInfo, stats) {
  const bucketSummary = RATING_BUCKETS
    .map(b => `${b}:${(stats.bucketMap[b]||[]).length}`)
    .join(', ');
  const topTags = Object.entries(stats.tagMap)
    .sort((a,b) => b[1].total - a[1].total).slice(0,20)
    .map(([tag, d]) => `${tag}(${d.total})`).join(', ');
  const weakTags = Object.entries(stats.tagMap)
    .filter(([,d]) => d.total <= 2).map(([t]) => t).join(', ') || 'None';
  const subInfo = stats.recentSubs
    .map((s,i) => `${i+1}. "${s.problem}" rating:${s.rating} tags:[${s.tags.join(',')}] lang:${s.lang} time:${s.timeMs}ms`)
    .join('\n');
  let contestInfo = "No contests yet.";
  if (stats.contestStats) {
    const c = stats.contestStats;
    contestInfo = `${c.totalContests} contests | current:${c.currentRating} | peak:${c.peakRating} | +${c.positiveContests}/-${c.negativeContests}`;
  }

  return `You are an expert competitive programming coach.

CODER PROFILE:
Handle: ${userInfo.handle}
Rating: ${userInfo.rating || 'Unrated'} | Rank: ${userInfo.rank || 'N/A'}
Total problems solved: ${stats.totalSolved}
Comfort zone: ${stats.comfortBucket} | Next target: ${stats.nextBucket} | After that: ${stats.nextNextBucket}
Problems per rating: ${bucketSummary}
Top problem tags solved: ${topTags}
Weak tags (2 or fewer solves): ${weakTags}
Tag gaps needed for ${stats.nextBucket}: ${stats.tagGaps.join(', ') || 'none identified'}
Contest history: ${contestInfo}
Recent 8 accepted submissions:
${subInfo}

INSTRUCTIONS:
Your response must contain EXACTLY these four tagged sections in this order.
Do NOT add anything before the first tag or after the last tag.
Do NOT use markdown, asterisks (*), bold (**), or hashes (#).
Use plain text only. Numbered lists only.

[KNOW]
Based on the problem tags and solving patterns, list what this coder already knows.
Group into two parts:
Clearly knows: (list specific concepts like basic loops, arrays, strings, functions, sorting, greedy, math, etc.)
Partially knows: (list concepts they have touched but not mastered)
[KNOW_END]

[LEARN]
Write a numbered step-by-step learning roadmap to go from ${stats.comfortBucket} to ${stats.nextBucket} to ${stats.nextNextBucket}.
For each step:
- Write the concept name exactly (examples: STL vector, unordered_map, prefix sum, binary search, two pointers, recursion, modular arithmetic, sorting with comparator, greedy approach, pass by reference, struct and pair, etc.)
- One sentence on why this matters in competitive programming
- How many problems to practice: write "Practice: X problems"
Order from most basic to most advanced. Be very specific and concrete.
[LEARN_END]

[WEAK]
List the specific programming concepts and data structures this coder is NOT using or is weak in.
For each one write the concept name and one sentence on why mastering it will help solve harder problems.
[WEAK_END]

[CONTEST]
Analyze the contest history and give 3 to 5 numbered concrete actionable tips to improve contest rating.
If no contest history, give general tips for a coder at ${stats.comfortBucket} rating.
[CONTEST_END]`;
}

// ═══════════════════════════════════════════
// GEMINI API
// ═══════════════════════════════════════════

async function callGemini(prompt) {
  const res = await fetch('/api/analyze', {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "AI analysis failed. Try again.");
  }
  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 8192, temperature: 0.4 },
```

**Fix 2 — Tell Gemini to be brief in KNOW section so it doesn't waste tokens. Find the `[KNOW]` instruction in `buildPrompt` and replace it:**

Find:
```
[KNOW]
Based on the problem tags and solving patterns, list what this coder already knows.
Group into two parts:
Clearly knows: (list specific concepts like basic loops, arrays, strings, functions, sorting, greedy, math, etc.)
Partially knows: (list concepts they have touched but not mastered)
[KNOW_END]
```

Replace with:
```
[KNOW]
In maximum 8 bullet points total, list what this coder already knows based on their tags.
Write "Clearly knows:" then up to 5 items. Write "Partially knows:" then up to 3 items.
Be brief — one line per item only.
[KNOW_END]
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || "Gemini API call failed. Check API key.");
  }
  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}

// ═══════════════════════════════════════════
// PARSE AI RESPONSE
// Tag-based extraction — completely immune to
// Gemini's markdown formatting habits.
// ═══════════════════════════════════════════

function parseAnalysis(raw) {
  console.log("=== GEMINI RAW ===\n", raw);

  // Find positions of all opening tags
  const tags = ['KNOW', 'LEARN', 'WEAK', 'CONTEST'];
  const positions = {};
  for (const tag of tags) {
    const idx = raw.indexOf(`[${tag}]`);
    positions[tag] = idx;
  }

  function extract(tag) {
    const start = positions[tag];
    if (start === -1) return null;

    const contentStart = start + tag.length + 2; // skip past [TAG]

    // End = wherever the next tag starts, or end of string
    let end = raw.length;
    for (const other of tags) {
      if (other === tag) continue;
      const otherPos = positions[other];
      if (otherPos > contentStart && otherPos < end) {
        end = otherPos;
      }
    }

    return raw.slice(contentStart, end).trim()
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/^#+\s*/gm, '')
      .replace(/\[KNOW_END\]/g, '')
      .replace(/\[LEARN_END\]/g, '')
      .replace(/\[WEAK_END\]/g, '')
      .replace(/\[CONTEST_END\]/g, '')
      .trim();
  }

  return {
    know:    extract('KNOW'),
    learn:   extract('LEARN'),
    weak:    extract('WEAK'),
    contest: extract('CONTEST'),
  };
}

// ═══════════════════════════════════════════
// RENDER FUNCTIONS
// ═══════════════════════════════════════════

function aiBlock(text, label, color) {
  if (!text) return '';
  return `
    <div style="margin-top:20px;padding-top:18px;border-top:1px solid #161b27">
      <div class="ai-label" style="color:${color}">▸ ${label}</div>
      <div class="ai-output" style="margin-top:8px;padding-top:0;border-top:none">${text}</div>
    </div>`;
}

function renderUserCard(userInfo, stats) {
  document.getElementById('userCard').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px">
      <div>
        <div style="font-size:1.4rem;font-weight:700;color:#e6edf3;margin-bottom:4px">
          ${userInfo.handle}
          <span style="font-size:0.7rem;color:#4a5568;background:#0a0e1a;border:1px solid #1a2744;padding:2px 10px;border-radius:4px;margin-left:8px;vertical-align:middle;text-transform:uppercase;letter-spacing:0.08em">
            ${userInfo.rank || 'unrated'}
          </span>
        </div>
        <div style="font-size:0.78rem;color:#4a5568">
          Comfort zone: <span style="color:#ffc947">${stats.comfortBucket}</span> &nbsp;·&nbsp;
          Next target: <span style="color:#58a6ff">${stats.nextBucket}</span>
        </div>
      </div>
      <div class="stat-row" style="margin-top:0">
        <div class="stat"><div class="val" style="color:${ratingColor(userInfo.rating)}">${userInfo.rating||'—'}</div><div class="lbl">Rating</div></div>
        <div class="stat"><div class="val" style="color:${ratingColor(userInfo.maxRating)}">${userInfo.maxRating||'—'}</div><div class="lbl">Peak</div></div>
        <div class="stat"><div class="val" style="color:#38d39f">${stats.totalSolved}</div><div class="lbl">Solved</div></div>
        <div class="stat"><div class="val" style="color:#a78bfa">${stats.contestStats?.totalContests||'—'}</div><div class="lbl">Contests</div></div>
      </div>
    </div>`;
}

function renderOverview(stats, ai) {
  const max = Math.max(...RATING_BUCKETS.map(b => (stats.bucketMap[b]||[]).length), 1);
  const bars = RATING_BUCKETS.map(b => {
    const count  = (stats.bucketMap[b]||[]).length;
    const cls    = b === stats.comfortBucket ? 'comfort' : b === stats.nextBucket ? 'next' : '';
    return `<div class="bar-row">
      <span class="bar-label ${cls}">${b}</span>
      <div class="bar-wrap"><div class="bar-fill ${cls}" style="width:${(count/max)*100}%"></div></div>
      <span class="bar-count">${count}</span>
    </div>`;
  }).join('');
  document.getElementById('panel-0').innerHTML =
    `<div class="section-title">Problems solved by rating</div>${bars}` +
    aiBlock(ai?.know, 'What You Already Know', '#38d39f');
}

function renderTopics(stats, ai) {
  const chips = Object.entries(stats.tagMap)
    .sort((a,b) => b[1].total - a[1].total)
    .map(([tag, d]) => {
      const cls = d.total >= 10 ? 'chip-strong' : d.total >= 4 ? 'chip-medium' : 'chip-weak';
      return `<span class="chip ${cls}">${tag} (${d.total})</span>`;
    }).join('');
  document.getElementById('panel-1').innerHTML =
    `<div class="section-title">
      <span style="color:#38d39f">■</span> Strong (10+) &nbsp;
      <span style="color:#ffc947">■</span> Medium (4–9) &nbsp;
      <span style="color:#ff6b6b">■</span> Weak (1–3)
    </div>${chips || '<p style="color:#4a5568">No tag data.</p>'}` +
    aiBlock(ai?.know, 'AI Coach — Topic Analysis', '#58a6ff');
}

function renderWeaknesses(stats, ai) {
  const gapChips = stats.tagGaps.length > 0
    ? stats.tagGaps.map(t => `<span class="chip chip-gap">${t}</span>`).join('')
    : '<span style="color:#4a5568;font-size:0.82rem">No major gaps at this level.</span>';
  const weakChips = Object.entries(stats.tagMap)
    .filter(([,d]) => d.total <= 2)
    .map(([t]) => `<span class="chip chip-weak">${t}</span>`).join('')
    || '<span style="color:#4a5568;font-size:0.82rem">None.</span>';
  document.getElementById('panel-2').innerHTML =
    `<div class="section-title">Tag gaps for ${stats.nextBucket}-rated problems</div>
    <div style="margin-bottom:18px">${gapChips}</div>
    <div class="section-title">Barely practiced topics (≤2 solves)</div>
    <div>${weakChips}</div>` +
    aiBlock(ai?.weak, 'AI Coach — Weakness Analysis', '#ff6b6b');
}

function renderRoadmap(stats, ai) {
  const path = `<div style="font-size:0.82rem;color:#4a5568;margin-bottom:20px">
    Path: <span style="color:#ffc947">${stats.comfortBucket}</span>
    <span style="color:#2a3a4a"> ──→ </span>
    <span style="color:#58a6ff">${stats.nextBucket}</span>
    <span style="color:#2a3a4a"> ──→ </span>
    <span style="color:#38d39f">${stats.nextNextBucket}</span>
  </div>`;

  const knowBlock = ai?.know ? `
    <div style="margin-bottom:28px">
      <div style="font-size:0.72rem;color:#38d39f;text-transform:uppercase;letter-spacing:0.1em;
                  padding:8px 14px;background:rgba(56,211,159,0.07);border-left:3px solid #38d39f;
                  border-radius:0 4px 4px 0;margin-bottom:12px">
        ✓ What You Already Know
      </div>
      <div class="ai-output" style="margin-top:0;padding-top:0;border-top:none">${ai.know}</div>
    </div>` : '';

  const learnBlock = ai?.learn ? `
    <div>
      <div style="font-size:0.72rem;color:#58a6ff;text-transform:uppercase;letter-spacing:0.1em;
                  padding:8px 14px;background:rgba(88,166,255,0.07);border-left:3px solid #58a6ff;
                  border-radius:0 4px 4px 0;margin-bottom:12px">
        → What To Learn Next
      </div>
      <div class="ai-output" style="margin-top:0;padding-top:0;border-top:none">${ai.learn}</div>
    </div>` :
    `<div style="color:#4a5568;font-size:0.82rem;padding:12px 0">
      ${ai ? 'Could not parse learning roadmap. Refresh and try again.' : 'Generating...'}
    </div>`;

  document.getElementById('panel-3').innerHTML = path + knowBlock + learnBlock;
}

function renderContests(stats, ai) {
  if (!stats.contestStats) {
    document.getElementById('panel-4').innerHTML =
      '<p style="color:#4a5568;font-size:0.82rem">No contest history found.</p>' +
      aiBlock(ai?.contest, 'AI Coach — Contest Advice', '#a78bfa');
    return;
  }
  const c = stats.contestStats;
  const statsRow = `<div class="stat-row" style="margin-bottom:20px">
    <div class="stat"><div class="val">${c.totalContests}</div><div class="lbl">Total</div></div>
    <div class="stat"><div class="val" style="color:#38d39f">+${c.positiveContests}</div><div class="lbl">Gained</div></div>
    <div class="stat"><div class="val" style="color:#ff6b6b">-${c.negativeContests}</div><div class="lbl">Lost</div></div>
    <div class="stat"><div class="val" style="color:${ratingColor(c.peakRating)}">${c.peakRating}</div><div class="lbl">Peak</div></div>
  </div>`;
  const rows = c.recentContests.map(r => `<tr>
    <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.name}</td>
    <td>#${r.rank}</td>
    <td class="${r.delta>0?'delta-pos':'delta-neg'}">${r.delta>0?'+':''}${r.delta}</td>
    <td style="color:${ratingColor(r.rating)}">${r.rating}</td>
  </tr>`).join('');
  const table = `<div class="section-title">Recent contests</div>
    <table class="contest-table">
      <thead><tr><th>Contest</th><th>Rank</th><th>Delta</th><th>Rating</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  document.getElementById('panel-4').innerHTML =
    statsRow + table + aiBlock(ai?.contest, 'AI Coach — Contest Insights', '#a78bfa');
}

function injectAI(ai, stats) {
  renderOverview(stats, ai);
  renderTopics(stats, ai);
  renderWeaknesses(stats, ai);
  renderRoadmap(stats, ai);
  renderContests(stats, ai);
}

// ═══════════════════════════════════════════
// TAB SWITCHER
// ═══════════════════════════════════════════

function switchTab(index) {
  document.querySelectorAll('.tab-panel').forEach((p, i) =>
    i === index ? p.classList.remove('hidden') : p.classList.add('hidden'));
  document.querySelectorAll('.tab').forEach((t, i) =>
    i === index ? t.classList.add('active') : t.classList.remove('active'));
}

// ═══════════════════════════════════════════
// MAIN ORCHESTRATOR
// ═══════════════════════════════════════════

async function startAnalysis() {
  const handle = document.getElementById('handleInput').value.trim();
  if (!handle) return showError("Please enter a Codeforces handle.");

  hide('errorBox');
  hide('results');
  show('loader');
  document.getElementById('analyzeBtn').disabled = true;

  try {
    setLoader("Fetching your Codeforces data...");
    const { submissions, ratingHistory, userInfo } = await fetchAll(handle);

    setLoader("Processing your problem history...");
    const stats = processData(submissions, ratingHistory);

    // Show raw stats immediately
    renderUserCard(userInfo, stats);
    renderOverview(stats, null);
    renderTopics(stats, null);
    renderWeaknesses(stats, null);
    renderRoadmap(stats, null);
    renderContests(stats, null);
    show('results');
    switchTab(0); // Start on Overview tab

    // Call Gemini and inject AI analysis
    setLoader("Asking Gemini AI to analyze your profile...");
    const prompt = buildPrompt(userInfo, stats);
    const raw    = await callGemini(prompt);
    const ai     = parseAnalysis(raw);
    injectAI(ai, stats);

  } catch (err) {
    showError(err.message);
    console.error(err);
  } finally {
    hide('loader');
    document.getElementById('analyzeBtn').disabled = false;
  }
}
