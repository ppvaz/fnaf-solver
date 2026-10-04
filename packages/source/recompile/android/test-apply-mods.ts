#!/usr/bin/env node
// FIXTURE regressions for apply-practice-mod.ts and apply-calib-mod.ts: each hook lands at its anchor, a moved
// anchor is refused by name, a patched calibration tree is left as it is, and a path in the repository is refused.
// The anchors are the generated source's and SDL's own lines; nothing here needs the owned game.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CALIB_IMPL, JAVA_NATIVE, patchJava, patchRuntime, refuseRepo } from './apply-calib-mod.ts';
import { HOOK, applyPractice } from './apply-practice-mod.ts';

const EVENTS = '#include "chowdren.h"\n#include "bitarray.h"\n\nvoid Frames::handle_frame_4_events()\n{\n    if (a) {\n        b();\n    }\n}\n'
  + 'void Frames::handle_frame_4_pre_events()\n{\n}\n';
const RUN = '#include "harness.cpp"\n\nvoid update()\n{\n    keyboard.update();\n    mouse.update();\n    platform_poll_events();\n\n'
  + '    // player controls\n    for (;;) {\n        int ret = update_frame();\n    }\n}\nvoid draw()\n{\n'
  + '    harness_after_draw(window_width, window_height);\n    PROFILE_BEGIN(platform_swap_buffers);\n    platform_swap_buffers();\n'
  + '    PROFILE_END();\n}\n';
const HARNESS = 'void seed(int index, unsigned int seed)\n{\n    fusion_graine = seed;\n    fusion_draws = 0;\n}\n'
  + 'void play(bool down)\n{\n    if (p) {\n        h_play_down = down;\n        return;\n    }\n}\n'
  + 'void harness_before_events(int frame_index)\n{\n    q();\n}\n';
const ACTIVITY = 'package org.libsdl.app;\n\nimport android.os.Build;\n\npublic class SDLActivity {\n'
  + '    public static native void onNativeTouch(int touchDevId, int pointerFingerId,\n        int action, float x, float y, float p);\n}\n';
const SURFACE = 'public class SDLSurface {\n    public boolean onTouch(View v, MotionEvent event) {\n        return true;\n    }\n}\n';
const JAVA = 'android-project/app/src/main/java/org/libsdl/app';

function tree(files: Readonly<Record<string, string>>) {
  const root = mkdtempSync(join(tmpdir(), 'apply-mods-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}
const read = (root: string, path: string) => readFileSync(join(root, path), 'utf8');

test('the practice hook lands before the office handler closes, with its includes', () => {
  const root = tree({ 'events_14.cpp': EVENTS });
  try {
    assert.equal(applyPractice(root), `enabled read-only practice HUD and input edge log: ${root}/events_14.cpp`);
    assert.equal(read(root, 'events_14.cpp'), EVENTS.replace('#include "bitarray.h"\n', '#include "bitarray.h"\n#include <cstdio>\n#include <SDL.h>\n#include "harness.h"\n')
      .replace('    }\n}\nvoid Frames::handle_frame_4_pre_events', `    }\n${HOOK}\n}\nvoid Frames::handle_frame_4_pre_events`));
    writeFileSync(join(root, 'events_14.cpp'), EVENTS.replace('#include "bitarray.h"\n', ''));
    assert.throws(() => applyPractice(root), /no longer has the expected include anchor/);
    writeFileSync(join(root, 'events_14.cpp'), EVENTS.replace('handle_frame_4_pre_events', 'handle_frame_5_pre_events'));
    assert.throws(() => applyPractice(root), /office event handler no longer has the expected anchor/);
    rmSync(join(root, 'events_14.cpp'));
    assert.throws(() => applyPractice(root), /missing generated office event source/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the calibration hooks land once each, and a patched tree is left as it is', () => {
  const root = tree({ 'base/run.cpp': RUN, 'base/harness.cpp': HARNESS, [`sdl/${JAVA}/SDLActivity.java`]: ACTIVITY, [`sdl/${JAVA}/SDLSurface.java`]: SURFACE });
  try {
    const said: string[] = [];
    patchRuntime(join(root, 'base'), line => said.push(line));
    patchJava(join(root, 'sdl'), line => said.push(line));
    assert.deepEqual(said.map(line => line.split(' in ')[0]), ['calibration hooks', 'seed and events hooks', 'MotionEvent hook declared', 'onTouch stamped']);
    assert.equal(read(root, 'base/calib_impl.h'), CALIB_IMPL);
    const run = read(root, 'base/run.cpp');
    for (const hook of ['#include "calib_impl.h" // FNAF2_CALIB_V1\n#include "harness.cpp"\n', '    calib_loop_start();\n    keyboard.update();\n',
      '    platform_poll_events();\n    calib_after_poll();\n', '        int ret = update_frame();\n        calib_after_update(frame->index,',
      '    CALIB_DRAW_BEACON();\n    harness_after_draw(', '    PROFILE_END();\n    calib_after_swap();\n}\n'])
      assert.equal(run.split(hook).length, 2, hook);
    const harness = read(root, 'base/harness.cpp');
    assert.ok(harness.includes('    fusion_draws = 0;\n    calib_seed(index, seed); // FNAF2_CALIB_V1\n')
      && harness.includes('        h_play_down = down;\n        calib_play_fingers(new_touch, end_touch, move_touch); // FNAF2_CALIB_V1\n        return;\n')
      && harness.includes('{\n    calib_mark_events(); // FNAF2_CALIB_V1\n    q();'));
    const activity = read(root, `sdl/${JAVA}/SDLActivity.java`);
    assert.ok(activity.includes(`${JAVA_NATIVE}    public static native void onNativeTouch(`) && activity.includes('import android.os.Build;\nimport android.view.MotionEvent;\n'));
    assert.ok(read(root, `sdl/${JAVA}/SDLSurface.java`).includes('MotionEvent event) {\n        SDLActivity.calibTouch(event); // FNAF2_CALIB_V1\n'));

    const before = [run, harness, activity];
    said.length = 0;
    patchRuntime(join(root, 'base'), line => said.push(line));
    patchJava(join(root, 'sdl'), line => said.push(line));
    assert.deepEqual(said, [`calibration layer already present: ${root}/base/run.cpp`]);
    assert.deepEqual([read(root, 'base/run.cpp'), read(root, 'base/harness.cpp'), read(root, `sdl/${JAVA}/SDLActivity.java`)], before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a moved or doubled anchor is refused by name, and a path in the repository is refused', () => {
  const root = tree({ 'base/run.cpp': RUN.replace('    PROFILE_END();\n}\n', '    PROFILE_END();\n    }\n'), 'base/harness.cpp': HARNESS,
    'twice/run.cpp': `${RUN}#include "harness.cpp"\n` });
  try {
    assert.throws(() => patchRuntime(join(root, 'base'), () => {}), {
      message: "run.cpp: expected exactly one anchor, found 0: '    harness_after_draw(window_width, window_height);\\n    PRO'" });
    assert.throws(() => patchRuntime(join(root, 'twice'), () => {}), { message: `run.cpp: expected exactly one anchor, found 2: '#include "harness.cpp"\\n'` });
    const repo = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '');
    assert.throws(() => refuseRepo(`${repo}/no-such-dir`), /inside the repository; patch a private copy/);
    assert.throws(() => refuseRepo(repo), /inside the repository/);
    assert.doesNotThrow(() => refuseRepo(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
