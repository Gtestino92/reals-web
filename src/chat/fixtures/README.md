# Audio fixture

`valid-aac-short.m4a` is copied byte-for-byte from the read-only backend fixture at `reals-backend/src/test/resources/fixtures/audio/valid-aac-short.m4a` (`ChatAudioValidationServiceTest`). It is used only by isolated browser checks to exercise admitted-file preview and native playback, never as microphone output or a production upload shortcut.

`audio.test-support.ts` separately builds synthetic ISO-BMFF containers for unit-test boundary cases. Those containers establish parser admission behavior, not audible recording quality or hardware support.

`chrome-aac-fragmented.mp4` is native Chrome MediaRecorder output from a generated WebAudio oscillator (no microphone or personal audio). It exercises real fragmented AAC finalization; tests assert encoded sample and codec bytes are unchanged and strict duration/size admission remains in force. Regenerate explicitly with `node tools/first-chat-composer.mjs --corrections --capture-audio-fixture`.
