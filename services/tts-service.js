require('dotenv').config();
const { Buffer } = require('node:buffer');
const EventEmitter = require('events');
const fetch = require('node-fetch');

class TextToSpeechService extends EventEmitter {
  constructor() {
    super();
    this.nextExpectedIndex = 0;
    this.speechBuffer      = {};
  }

  async generate(gptReply, interactionCount) {
    const { partialResponseIndex, partialResponse } = gptReply;
    if (!partialResponse) return;

    try {
      // ───── 1. Choose the Deepgram model (env var → sane default) ─────
      const MODEL = process.env.DEEPGRAM_TTS_MODEL || 'aura-2-callista-en';

      // ───── 2. Build the /v1/speak URL safely ─────
      const url =
        'https://api.deepgram.com/v1/speak?' +
        new URLSearchParams({
          model:       MODEL,
          encoding:    'mulaw',
          sample_rate: '8000',
          container:   'none'
        });

      // ───── 3. Call Deepgram TTS ─────
      const response = await fetch(url, {
        method:  'POST',
        headers: {
          Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text: partialResponse })
      });

      if (response.ok) {
        const audioBuffer   = await response.arrayBuffer();
        const base64Payload = Buffer.from(audioBuffer).toString('base64');
        this.emit('speech', partialResponseIndex, base64Payload, partialResponse, interactionCount);
      } else {
        console.error('Deepgram TTS error:', response.status, await response.text());
      }
    } catch (err) {
      console.error('Error occurred in TextToSpeech service:', err);
    }
  }
}

module.exports = { TextToSpeechService };
