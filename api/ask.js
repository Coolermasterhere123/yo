const Groq       = require('groq-sdk');
const { toFile } = require('groq-sdk');

const groq = new Groq({ apiKey: (process.env.GROQ_API_KEY || '').trim() });

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { audio, mime, history = [] } = req.body || {};

  if (!audio) return res.status(400).json({ error: 'No audio provided' });

  // ── Transcribe ─────────────────────────────────────────────────────────────
  const buf = Buffer.from(audio, 'base64');
  console.log(`Audio: ${buf.length} bytes  mime: ${mime}`);

  if (buf.length < 600) {
    return res.status(200).json({ transcript: '', reply: '', noise: true, reason: 'too_short' });
  }

  let transcript = '';
  try {
    const ext  = (mime || '').includes('mp4') ? 'mp4'
               : (mime || '').includes('ogg') ? 'ogg' : 'webm';
    const file = await toFile(buf, `audio.${ext}`, { type: mime || 'audio/webm' });
    const result = await groq.audio.transcriptions.create({
      file,
      model:           'whisper-large-v3-turbo',
      response_format: 'json',
      language:        'en',
    });
    transcript = (result.text || '').trim();
    console.log(`Transcript: "${transcript}"`);
  } catch (e) {
    console.error('STT error:', e.message);
    return res.status(502).json({ error: 'Speech to text failed: ' + e.message });
  }

  // ── Noise filter ───────────────────────────────────────────────────────────
  const NOISE = new Set([
    '','you','thanks','thank you','the','um','uh','hmm','hm','oh',
    'okay','ok','hi','hello','bye','yeah','yep','nope','right',
    'thanks.','okay.','you.','oh.','yeah.','right.','bye.'
  ]);
  const clean = transcript.toLowerCase().replace(/[.,!?]+$/, '').trim();
  if (!clean || clean.length < 2 || NOISE.has(clean)) {
    return res.status(200).json({ transcript, reply: '', noise: true, reason: 'noise' });
  }

  // ── Chat ───────────────────────────────────────────────────────────────────
  let reply = '';
  try {
    const chat = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content:
            'You are Yo — brutally honest, casually sweary, genuinely helpful voice assistant. ' +
            'Respond in 1 to 3 short spoken sentences. No markdown, no lists, no asterisks. ' +
            'Plain speech only. Swear naturally but sparingly. Always actually answer.',
        },
        ...history.slice(-10),
        { role: 'user', content: transcript },
      ],
      max_tokens:  180,
      temperature: 0.85,
    });
    reply = (chat.choices?.[0]?.message?.content || '').trim();
    console.log(`Reply: "${reply}"`);
  } catch (e) {
    console.error('Chat error:', e.message);
    return res.status(502).json({ error: 'Chat failed: ' + e.message });
  }

  return res.status(200).json({ transcript, reply });
};
