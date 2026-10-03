package com.ppvaz.fnafcompanion;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.util.Log;

/** Debug-only shell command bridge that does not create or focus a window. */
public final class AccessibilityGameProbeReceiver extends BroadcastReceiver {
    private static final String TAG = AccessibilityProbeService.TAG;
    private static final String EXTRA_X = "x";
    private static final String EXTRA_Y = "y";
    private static final String EXTRA_DURATION_MS = "durationMs";
    private static final String EXTRA_DELAY_MS = "delayMs";
    private static final String EXTRA_LABEL = "label";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        // The point comes from the caller's resolved profile, never from here:
        // an intent without one is refused rather than tapped at a default.
        if (!intent.hasExtra(EXTRA_X) || !intent.hasExtra(EXTRA_Y)) {
            Log.w(TAG, "game-probe-receiver refused: no x/y extras");
            return;
        }
        int x = intent.getIntExtra(EXTRA_X, -1);
        int y = intent.getIntExtra(EXTRA_Y, -1);
        long durationMs = Math.max(1L, Math.min(30000L,
                intent.getLongExtra(EXTRA_DURATION_MS, 33L)));
        long delayMs = Math.max(0L, Math.min(30000L,
                intent.getLongExtra(EXTRA_DELAY_MS, 350L)));
        String label = intent.getStringExtra(EXTRA_LABEL);
        if (label == null || label.isEmpty()) label = "game-probe";
        Log.i(TAG, "game-probe-receiver label=" + label
                + " point=" + x + "," + y
                + " durationMs=" + durationMs
                + " delayMs=" + delayMs
                + " uptimeMs=" + SystemClock.uptimeMillis());
        boolean scheduled = AccessibilityProbeService.dispatchSingleAfter(
                label, x, y, durationMs, delayMs);
        Log.i(TAG, "game-probe-receiver-result label=" + label
                + " scheduled=" + scheduled
                + " uptimeMs=" + SystemClock.uptimeMillis());
    }
}
