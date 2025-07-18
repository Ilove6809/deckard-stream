/*  services/stream-service.js
    Handles buffering and sending TTS audio back to Twilio in real-time. */

const EventEmitter = require('events');
const uuid         = require('uuid');

const FRAME_BYTES = 160;            // 20 ms of 8 kHz µ-law

class StreamService extends EventEmitter {
  constructor (websocket) {
    super();
    this.ws                 = websocket;
    this.expectedAudioIndex = 0;
    this.audioBuffer        = {};
    this.streamSid          = '';   // filled from Twilio “start” event
  }

  /* Called from app.js when Twilio sends the `start` packet */
  setStreamSid (sid) {
    this.streamSid = sid;
  }

  /* Keeps audio in natural order even if packets arrive early/late */
  buffer (index, audio) {
    if (index === null) {
      this.sendAudio(audio).catch(console.error);          // non-blocking
    } else if (index === this.expectedAudioIndex) {
      this.sendAudio(audio).catch(console.error);          // non-blocking
      this.expectedAudioIndex++;

      while (Object.prototype.hasOwnProperty.call(
               this.audioBuffer, this.expectedAudioIndex)) {
        const buffered = this.audioBuffer[this.expectedAudioIndex];
        this.sendAudio(buffered).catch(console.error);     // non-blocking
        this.expectedAudioIndex++;
      }
    } else {
      this.audioBuffer[index] = audio;
    }
  }

  /* ── slice → base64 → paced send ── */
  async sendAudio (base64WholeAudio) {
    if (!this.streamSid || !this.ws) return;

    const raw = Buffer.from(base64WholeAudio, 'base64');

    for (let i = 0; i < raw.length; i += FRAME_BYTES) {
      const payload = raw.subarray(i, i + FRAME_BYTES).toString('base64');
      if (!payload) continue;

      /* log first frame of each utterance for debugging */
      if (i === 0) console.log('[OUT]', this.streamSid.slice(0, 8), payload.length);
      this.ws.send(JSON.stringify({
        streamSid: this.streamSid,
        event:     'media',           
        media: { payload }             
      }));

      /* pace frames so Twilio treats them as real-time audio */
      await new Promise(r => setTimeout(r, 20));
    }

    /* mark end of utterance */
    const mark = uuid.v4();
    this.ws.send(JSON.stringify({
      streamSid: this.streamSid,
      event:     'mark',
      mark:      { name: mark }
    }));
    this.emit('audiosent', mark);
  }
}

module.exports = { StreamService };
