/*  services/stream-service.js
    Handles buffering and sending TTS audio back to Twilio in real-time. */

const EventEmitter = require('events');
const uuid         = require('uuid');

const FRAME_BYTES  = 160;   // 20 ms of 8 kHz μ-law (Twilio’s required frame)

class StreamService extends EventEmitter {
  constructor (websocket) {
    super();
    this.ws                = websocket;
    this.expectedAudioIndex = 0;
    this.audioBuffer        = {};
    this.streamSid          = '';      // filled in from Twilio "start" event
  }

  /* Called from app.js when Twilio sends the `start` packet */
  setStreamSid (streamSid) {
    this.streamSid = streamSid;
  }

  /* Maintains natural order when partials arrive out of sequence */
  buffer (index, audio) {
    if (index === null) {
      this.sendAudio(audio);
    } else if (index === this.expectedAudioIndex) {
      this.sendAudio(audio);
      this.expectedAudioIndex++;

      while (Object.prototype.hasOwnProperty.call(
               this.audioBuffer, this.expectedAudioIndex)) {
        const buffered = this.audioBuffer[this.expectedAudioIndex];
        this.sendAudio(buffered);
        this.expectedAudioIndex++;
      }
    } else {
      this.audioBuffer[index] = audio;
    }
  }

  /* ───────── slice → base-64 → paced send ───────── */
  async sendAudio (base64WholeAudio) {
    if (!this.streamSid || !this.ws) return;

    const raw = Buffer.from(base64WholeAudio, 'base64');   // back to bytes

    for (let i = 0; i < raw.length; i += FRAME_BYTES) {
      const slice   = raw.subarray(i, i + FRAME_BYTES);
      if (!slice.length) continue;

      const payload = slice.toString('base64');

      /* log the first frame so we can verify SID + size in Render */
      if (i === 0) console.log('[OUT]', this.streamSid || '<noSid>', payload.length);

      /* Twilio spec: outbound frame JSON – no extra keys */
      this.ws.send(JSON.stringify({
        streamSid: this.streamSid,
        event:     'media',
        track:     'outbound', ← mandatory on outbound frames
        media:     { payload }
      }));

      /* pace frames at real-time speed (≈20 ms) so Twilio plays them */
      await new Promise(r => setTimeout(r, 20));
    }

    /* mark end of utterance (helps Twilio flush audio) */
    const markLabel = uuid.v4();
    this.ws.send(JSON.stringify({
      streamSid: this.streamSid,
      event:     'mark',
      mark:      { name: markLabel }
    }));
    this.emit('audiosent', markLabel);
  }
}

module.exports = { StreamService };
