#!/usr/bin/env node
// The audio preflight's reading of `dumpsys audio`, on the lines the phone
// printed on 2026-09-27 after n5c (trimmed: no media, only the player table):
// org.fnaf2rebuild.play (uid 10783) held a started player behind FNaF 4.
import { startedPlayers, packagesByUid, audioVerdict, audioPreflight, COMPANION } from './audio-players.ts';

const failures = [];
let checks = 0;
const ok = (what, c) => { checks += 1; if (!c) failures.push(what); };

const DUMP = `PlaybackActivityMonitor dump time: 9:17:50 PM

  playback listeners:
 PlayMonitorClient:S uid:1000 pid:2454

  players:
(not logged)  AudioPlaybackConfiguration piid:591 deviceIds:[] type:android.media.SoundPool u/pid:1000/2454 state:idle attr:AudioAttributes: usage=USAGE_ASSISTANCE_SONIFICATION content=CONTENT_TYPE_SONIFICATION flags=0x800
  AudioPlaybackConfiguration piid:599 deviceIds:[] type:android.media.SoundPool u/pid:10332/3154 state:idle attr:AudioAttributes: usage=USAGE_ASSISTANCE_SONIFICATION content=CONTENT_TYPE_SONIFICATION flags=0x800
  AudioPlaybackConfiguration piid:27447 deviceIds:[18099] type:OpenSL ES AudioPlayer (Buffer Queue) u/pid:10783/6963 state:started attr:AudioAttributes: usage=USAGE_MEDIA content=CONTENT_TYPE_UNKNOWN source=DEFAULT flags=0x0
  AudioPlaybackConfiguration piid:27599 deviceIds:[] type:android.media.SoundPool u/pid:10169/8299 state:idle attr:AudioAttributes: usage=USAGE_MEDIA content=CONTENT_TYPE_UNKNOWN flags=0x800
  AudioPlaybackConfiguration piid:27615 deviceIds:[] type:android.media.MediaPlayer u/pid:10169/8299 state:started attr:AudioAttributes: usage=USAGE_MEDIA content=CONTENT_TYPE_UNKNOWN flags=0x800

  ducked players piids:

  current piid to portId map:
  piid: 27447 portId: 18104

Events log: playback activity as reported through PlayerBase
09-27 21:15:34:975 player piid:27095 event:started
  AudioPlaybackConfiguration piid:11 deviceIds:[] type:android.media.MediaPlayer u/pid:10999/1 state:started attr:AudioAttributes: usage=USAGE_MEDIA
`;
const PM = `package:org.fnaf2rebuild.play uid:10783
package:com.scottgames.fnaf4 uid:10169
package:com.scottgames.fnaf2 uid:10781
package:com.android.systemui uid:10332
package:com.ppvaz.fnafcompanion uid:10500
`;

const players = startedPlayers(DUMP);
ok(`two started players in the table (${players.map((p) => p.uid)})`, players.length === 2);
ok('the rebuild app\'s player is read with its uid, pid and usage',
  players.some((p) => p.uid === 10783 && p.pid === 6963 && p.usage === 'USAGE_MEDIA' && p.type.startsWith('OpenSL ES')));
ok('idle and stopped players are not started', !players.some((p) => p.piid === 599 || p.piid === 591));
ok('a line after the table (the events log) is not a player', !players.some((p) => p.uid === 10999));
const byUid = packagesByUid(PM);
ok('uids map to packages', byUid.get(10783)?.[0] === 'org.fnaf2rebuild.play' && byUid.get(10169)?.[0] === 'com.scottgames.fnaf4');

const refused = audioVerdict(players, byUid, ['com.scottgames.fnaf4', COMPANION]);
ok(`n5c's phone is REFUSED for FNaF 4 (${refused.reason})`, refused.status === 'REFUSED');
ok('the refusal names the uid and the package', /uid 10783 org\.fnaf2rebuild\.play/.test(refused.reason ?? ''));
ok('the target\'s own player is not foreign', !refused.foreign.some((p) => p.uid === 10169));

const alone = startedPlayers(DUMP.replace('u/pid:10783/6963 state:started', 'u/pid:10783/6963 state:stopped'));
ok('with the rebuild app stopped, FNaF 4 alone is READY', audioVerdict(alone, byUid, ['com.scottgames.fnaf4', COMPANION]).status === 'READY');
const companion = startedPlayers(DUMP.replace('u/pid:10783/6963', 'u/pid:10500/77'));
ok('the Companion may play', audioVerdict(companion, byUid, ['com.scottgames.fnaf4', COMPANION]).status === 'READY');
const unknownUid = startedPlayers(DUMP.replace('u/pid:10783/6963', 'u/pid:10444/77'));
ok('an app uid with no package still refuses, as UNKNOWN(package)',
  /UNKNOWN\(package\)/.test(audioVerdict(unknownUid, byUid, ['com.scottgames.fnaf4', COMPANION]).reason ?? ''));
const system = startedPlayers(DUMP.replace('u/pid:10783/6963', 'u/pid:1000/77'));
ok('a system uid (< 10000) is not an app', audioVerdict(system, byUid, ['com.scottgames.fnaf4', COMPANION]).status === 'READY');

// The phone path, with adb injected: an unreadable phone is UNKNOWN, not READY.
const fake = (dump, pm) => (args) => (args.includes('dumpsys') ? dump : pm);
ok('the phone path refuses the fixture', audioPreflight({ serial: 'X', target: 'com.scottgames.fnaf4', adb: fake(DUMP, PM) }).status === 'REFUSED');
ok('a dump without the monitor is UNKNOWN', audioPreflight({ serial: 'X', target: 'com.scottgames.fnaf4', adb: fake('nothing', PM) }).status === 'UNKNOWN');
ok('adb failing is UNKNOWN', audioPreflight({ serial: 'X', target: 'com.scottgames.fnaf4', adb: () => { throw new Error('no device'); } }).status === 'UNKNOWN');

console.log(`test-audio-players: ${checks - failures.length}/${checks} checks passed`);
for (const f of failures) console.log(`FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
