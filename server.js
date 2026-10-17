require('dotenv').config();
const express = require('express');
const path = require('path');
const app = express();
const PORT = Number(process.env.PORT || 3000);
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const CHAT_MODEL = process.env.CF_CHAT_MODEL || '@cf/meta/llama-3.1-8b-instruct-fp8';
const VISION_MODEL = process.env.CF_VISION_MODEL || '@cf/meta/llama-3.2-11b-vision-instruct';
const IMAGE_MODEL = process.env.CF_IMAGE_MODEL || '@cf/black-forest-labs/flux-2-klein-4b';
const appUrl = (model) => `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/v1/chat/completions`;
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function ready(res) {
  if (!ACCOUNT_ID || !API_TOKEN) {
    res.status(503).json({ error: 'Cloudflare AI is not configured. Add CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to your .env file, then restart the server.' });
    return false;
  }
  return true;
}
async function cloudflareChat(messages, model) {
  const response = await fetch(appUrl(model), {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: 1200 }),
    signal: AbortSignal.timeout(90000)
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = { error: raw.slice(0, 1000) }; }
  if (!response.ok) {
    const details = data?.errors?.map(x => x.message).join('; ') || data?.error?.message || data?.error || raw || `HTTP ${response.status}`;
    const err = new Error(String(details)); err.status = response.status; throw err;
  }
  const reply = data?.choices?.[0]?.message?.content;
  if (typeof reply === 'string' && reply.trim()) return reply;
  if (Array.isArray(reply)) {
    const combined = reply.map(p => typeof p === 'string' ? p : p?.text || '').join('');
    if (combined.trim()) return combined;
  }
  throw new Error('Cloudflare returned no text response. Check the selected model.');
}
app.get('/api/config', (_req, res) => res.json({ firebase: {
  apiKey: process.env.FIREBASE_API_KEY || '',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.FIREBASE_APP_ID || ''
}}));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'Nexus AI', provider: 'Cloudflare Workers AI', time: new Date().toISOString() }));
app.post('/api/chat', async (req, res) => {
  if (!ready(res)) return;
  const messages = req.body?.messages;
  if (!Array.isArray(messages) || !messages.length || messages.length > 60) return res.status(400).json({ error: 'Please send a valid conversation.' });
  const hasImages = messages.some(m => Array.isArray(m?.content) && m.content.some(p => p?.type === 'image_url'));
  const model = hasImages ? VISION_MODEL : CHAT_MODEL;
  const safeMessages = messages.map(m => {
    const role = ['system', 'user', 'assistant'].includes(m?.role) ? m.role : 'user';
    let content = m?.content;
    if (Array.isArray(content)) {
      content = content.slice(0, 8).map(part => {
        if (part?.type === 'text') return { type: 'text', text: String(part.text || '').slice(0, 20000) };
        if (part?.type === 'image_url' && typeof part.image_url?.url === 'string' && part.image_url.url.startsWith('data:image/')) {
          return { type: 'image_url', image_url: { url: part.image_url.url } };
        }
        return null;
      }).filter(Boolean);
    } else content = String(content || '').slice(0, 20000);
    return { role, content };
  });
  try { res.json({ reply: await cloudflareChat(safeMessages, model) }); }
  catch (e) { console.error('Cloudflare chat error:', e.status || '', e.message); res.status(e.status && e.status < 500 ? e.status : 502).json({ error: `Cloudflare AI error: ${e.message}` }); }
});
app.post('/api/memory', async (req, res) => {
  if (!ready(res)) return;
  const oldMemory = String(req.body?.memory || '').slice(0, 5000);
  const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(-16) : [];
  if (!messages.length) return res.json({ memory: oldMemory });
  const transcript = messages.map(m => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${String(m.content || '').slice(0, 1500)}`).join('\n');
  const prompt = `Update the user's persistent memory for future chats. Keep only useful stable facts, preferences, goals, and ongoing projects the user actually stated. Do not infer sensitive traits. Merge with existing memory, remove outdated contradictions, and keep it concise (maximum 1200 characters). If there is no useful new information, preserve the existing memory. Return only the memory text, no heading or explanation.\n\nExisting memory:\n${oldMemory || '(empty)'}\n\nRecent conversation:\n${transcript}`;
  try { const memory = await cloudflareChat([{ role: 'system', content: 'You maintain a concise, privacy-conscious user memory.' }, { role: 'user', content: prompt }], CHAT_MODEL); res.json({ memory: memory.trim().slice(0, 1600) }); }
  catch (e) { console.error('Memory update failed:', e.message); res.status(502).json({ error: 'Could not update memory right now.' }); }
});
app.post('/api/generate-image', async (req, res) => {
  if (!ready(res)) return;
  const prompt = String(req.body?.prompt || '').trim().slice(0, 3000);
  if (!prompt) return res.status(400).json({ error: 'Please enter an image prompt.' });
  const width = Math.max(256, Math.min(1024, Number(req.body?.width) || 1024));
  const height = Math.max(256, Math.min(1024, Number(req.body?.height) || 1024));
  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${IMAGE_MODEL}`;
    // FLUX.2 [klein] requires multipart/form-data, even for prompt-only requests.
    // Let Node's fetch generate the multipart boundary; do not set Content-Type manually.
    const form = new FormData();
    form.append('prompt', prompt);
    form.append('width', String(width));
    form.append('height', String(height));
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_TOKEN}` },
      body: form,
      signal: AbortSignal.timeout(120000)
    });
    const contentType = upstream.headers.get('content-type') || '';
    if (!upstream.ok) {
      const body = await upstream.text(); let msg = body;
      try { const parsed = JSON.parse(body); msg = parsed?.errors?.map(x => x.message).join('; ') || parsed?.error || body; } catch {}
      console.error('Cloudflare image error:', upstream.status, String(msg).slice(0, 1000));
      return res.status(upstream.status >= 500 ? 502 : upstream.status).json({ error: `Image generation failed: ${String(msg).slice(0, 500)}` });
    }
    if (contentType.includes('application/json')) {
      const data = await upstream.json();
      const image = data?.result?.image || data?.image;
      if (typeof image === 'string') return res.json({ image: image.startsWith('data:') ? image : `data:image/png;base64,${image}`, mimeType: 'image/png' });
      return res.status(502).json({ error: 'The image provider returned an unexpected response.' });
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (!buffer.length) return res.status(502).json({ error: 'The image provider returned an empty image.' });
    res.json({ image: `data:${contentType.startsWith('image/') ? contentType : 'image/png'};base64,${buffer.toString('base64')}`, mimeType: contentType || 'image/png' });
  } catch (e) { console.error('Image generation error:', e.message); res.status(502).json({ error: `Image generation failed: ${e.message}` }); }
});
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Nexus AI running at http://localhost:${PORT}`));
