const EventEmitter = require('events');
const uuid         = require('uuid');

const FRAME_BYTES = 160;          // 20 ms of 8 kHz µ-law

class StreamService extends EventEmitter {
  constructor (websocket) {
    super();
    this.ws                = websocket;
    this.expectedAudioIndex = 0;
    this.audioBuffer        = {};
    this.streamSid          = '';
  }

  /* Twilio sends the streamSid in its initial “start” message */
  setStreamSid (streamSid) {
    this.streamSid = streamSid;
  }

  /* handle arrival order (same logic you already had) */
  buffer (index, audio) {
    if (index === null) {
      this.sendAudio(audio);
    } else if (index === this.expectedAudioIndex) {
      this.sendAudio(audio);
      this.expectedAudioIndex++;

      while (Object.prototype.hasOwnProperty.call(this.audioBuffer, this.expectedAudioIndex)) {
        const bufferedAudio = this.audioBuffer[this.expectedAudioIndex];
        this.sendAudio(bufferedAudio);
        this.expectedAudioIndex++;
      }
    } else {
      this.audioBuffer[index] = audio;
    }
  }

  /* ────────── Core: slice → base64 → send ────────── */
  sendAudio (base64WholeAudio) {
    if (!this.streamSid || !this.ws) return;

    const raw = Buffer.from(base64WholeAudio, 'base64');   // back to bytes

    for (let i = 0; i < raw.length; i += FRAME_BYTES) {
      const slice   = raw.subarray(i, i + FRAME_BYTES);
      if (!slice.length) continue;

      const payload = slice.toString('base64');

      /* 🔍 print the very first frame of each utterance */
      if (i === 0) console.log('[OUT]', this.streamSid || '<noSid>', payload.length);

      this.ws.send(JSON.stringify({
        streamSid: this.streamSid,
        event:     'media',
        media:     { payload }
      }));
    }

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
