require('dotenv').config();
require('colors');

const express      = require('express');
const http         = require('http');          // 👈 new
const ExpressWs    = require('express-ws');

const { GptService }          = require('./services/gpt-service');
const { StreamService }       = require('./services/stream-service');
const { TranscriptionService }= require('./services/transcription-service');
const { TextToSpeechService } = require('./services/tts-service');
const { recordingService }    = require('./services/recording-service');

const VoiceResponse = require('twilio').twiml.VoiceResponse;

/* ─────────────────────────  App & WebSocket bootstrap ───────────────────────── */

const app    = express();
const server = http.createServer(app);         // 👈 new
ExpressWs(app, server);                        // 👈 attach ws to *server*

// Debug: log every WebSocket upgrade attempt
server.on('upgrade', () => {
  console.log('🔄  Upgrade event: WebSocket handshake attempt'.cyan);
});

const PORT = process.env.PORT || 3000;

/* ──────────────────────────  /incoming  (unused for outbound) ───────────────── */

app.post('/incoming', (req, res) => {
  try {
    const response = new VoiceResponse();
    const connect  = response.connect();
    connect.stream({ url: `wss://${process.env.SERVER}/connection` });

    res.type('text/xml');
    res.end(response.toString());
  } catch (err) {
    console.log(err);
  }
});

/* ──────────────────────────  WebSocket endpoint  ────────────────────────────── */

app.ws('/connection', (ws) => {
  console.log('✅ WebSocket connection opened!'.green);

  try {
    ws.on('error', console.error);

    // Filled in from start event
    let streamSid;
    let callSid;

    const gptService         = new GptService();
    const streamService      = new StreamService(ws);
    const transcriptionService = new TranscriptionService();
    const ttsService         = new TextToSpeechService({});

    let marks = [];
    let interactionCount = 0;

    /* Incoming messages from Twilio Media Stream */
    ws.on('message', (data) => {
      console.log('📩 Message received from Twilio'.cyan);
      const msg = JSON.parse(data);

      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        callSid   = msg.start.callSid;

        streamService.setStreamSid(streamSid);
        gptService.setCallSid(callSid);

        recordingService(ttsService, callSid).then(() => {
          console.log(
            `Twilio -> Starting Media Stream for ${streamSid}`.underline.red
          );
          ttsService.generate(
            {
              partialResponseIndex: null,
              partialResponse:
                "Hi! This is Deckard from Samurai Security. Thanks for taking the call — how are you today?",
            },
            0
          );
        });
      } else if (msg.event === 'media') {
        transcriptionService.send(msg.media.payload);
      } else if (msg.event === 'mark') {
        const label = msg.mark.name;
        console.log(
          `Twilio -> Audio completed mark (${msg.sequenceNumber}): ${label}`.red
        );
        marks = marks.filter((m) => m !== label);
      } else if (msg.event === 'stop') {
        console.log(
          `Twilio -> Media stream ${streamSid} ended.`.underline.red
        );
      }
    });

    transcriptionService.on('utterance', (text) => {
      if (marks.length > 0 && text?.length > 5) {
        console.log('Twilio -> Interruption, Clearing stream'.red);
        ws.send(
          JSON.stringify({
            streamSid,
            event: 'clear',
          })
        );
      }
    });

    transcriptionService.on('transcription', (text) => {
      if (!text) return;
      console.log(
        `Interaction ${interactionCount} – STT -> GPT: ${text}`.yellow
      );
      gptService.completion(text, interactionCount);
      interactionCount += 1;
    });

    gptService.on('gptreply', (gptReply, icount) => {
      console.log(
        `Interaction ${icount}: GPT -> TTS: ${gptReply.partialResponse}`.green
      );
      ttsService.generate(gptReply, icount);
    });

    ttsService.on('speech', (idx, audio, label, icount) => {
      console.log(
        `Interaction ${icount}: TTS -> TWILIO: ${label}`.blue
      );
      streamService.buffer(idx, audio);
    });

    streamService.on('audiosent', (markLabel) => {
      marks.push(markLabel);
    });
  } catch (err) {
    console.log(err);
  }
});

/* ───────────────────────────  health-check route  ───────────────────────────── */

app.get('/', (req, res) => {
  res.send('Deckard is live');
});

/* ───────────────────────────  start server  ─────────────────────────────────── */

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`.magenta);
});
