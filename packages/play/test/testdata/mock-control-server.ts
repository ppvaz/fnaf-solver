#!/usr/bin/env node
// Protocol stand-in for the helper's control socket, for the forward transport.
//
// Writes its listening port to the path given as the first argument, then answers requests until it is
// killed. It mirrors the verbs the helper serves so the host script is exercised end to end without a
// device. Ported from mock-control-server.py; it answers what that answered.
//
//   node packages/play/test/testdata/mock-control-server.ts PORT_FILE
import { writeFileSync } from 'node:fs';
import { type AddressInfo, createServer } from 'node:net';

// Field-for-field with the device (Fnaf2Legacy.snapshotLine/readLine, OverlayController.status) and with
// the loopback mock in mock-adb-companion.sh. Both transports must answer the same shape or a consumer
// that works over one silently fails over the other.
const SNAPSHOT = 'OK snapshotNs=9000 wallMs=1700000000000 visualCaptureNs=7800 nightOnsetImageNs=-1 visual=OBSERVED visualReason=none seq=121 ageUs=1200 content=2400x1080 visible=1 screen=FNAF2_NIGHT monitorUp=true monitorReason=native-stroke-monitor-up mask_button_downstroke=0 monitor_button_downstroke=140 watch=OFF spec=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa entries=12';
const READ = 'OK read=OBSERVED spec=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa seq=122 snapshotNs=10000 ageUs=1200 cam01_button=0 cam02_button=0 cam03_button=0 cam04_button=0 cam05_button=194 cam06_button=0 cam07_button=0 cam08_button=0 cam09_button=0 cam10_button=0 cam11_button=0 cam12_button=0';
const OVERLAY = 'OK overlay=READY teach=OFF f1=NONE f3=NONE f4=NONE';
const STATUS = 'OK schema=companion-status-v1 app=0.2.0 code=16 session=3 capture=ON captureReason=none content=2400x1080 visible=1 frames=18234 frameAgeMs=12 fps=59.8 target=com.scottgames.fnaf2 game=fnaf2 targetBuild=26:2.0.7 legacy=fnaf2 regions=0 regionSamples=0 regionFrames=0 lesson=NONE lessonState=OFF panel=NONE clearance=UNCHECKED overlayPermission=GRANTED lease=NONE battery=64 charging=1 thermal=NONE foreground=OTHER audioProbe=OFF snapshotNs=9000 wallMs=1700000000000';
const SPEC = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

// What Python's split() and strip() take for whitespace in ASCII text: 0x1c-0x1f too, which \s is not.
const SPACE = /[\t\n\v\f\r\x1c-\x1f ]+/;

function answer(request: string) {
  const field = request.split(SPACE).filter(Boolean);
  if (!field.length) return 'ERROR unknown-verb';
  if (field[0] === 'GET') return SNAPSHOT;
  if (field[0] === 'WATCH' && field.length === 3) return field[2] === 'status' ? `OK watch=OFF spec=${SPEC} entries=12` : `OK watch=ACTIVE spec=${SPEC} entries=12`;
  if (field[0] === 'READ' && field.length === 2) return READ;
  if (field[0] === 'OVERLAY' && field.length === 2) return OVERLAY;
  if (field[0] === 'STATUS' && field.length === 2) return STATUS;
  return 'ERROR unknown-verb';
}

const portFile = process.argv[2];
if (portFile === undefined) throw new Error('usage: mock-control-server.ts PORT_FILE');
const REPLACEMENT = String.fromCharCode(0xfffd);
// One read of at most 4096 bytes per connection, as recv(4096) took, decoded as ASCII with each other byte
// replaced; then one answer line, and the connection closes. A client that sends nothing before closing
// its side is answered too: recv returned b''.
const server = createServer({ allowHalfOpen: true }, client => {
  let answered = false;
  const reply = (request: string) => {
    if (answered) return;
    answered = true;
    client.end(`${answer(request)}\n`);
  };
  client.once('data', (chunk: Buffer) =>
    reply([...chunk.subarray(0, 4096)].map(byte => (byte < 0x80 ? String.fromCharCode(byte) : REPLACEMENT)).join('')));
  client.once('end', () => reply(''));
  client.on('error', () => client.destroy());
});
server.listen(0, '127.0.0.1', () => writeFileSync(portFile, String((server.address() as AddressInfo).port)));
