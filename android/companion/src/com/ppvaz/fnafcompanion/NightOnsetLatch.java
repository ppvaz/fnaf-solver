package com.ppvaz.fnafcompanion;

/**
 * Latches the image time of a night's first FNAF2_NIGHT frame.
 *
 * The Night 5 route scores 3000/3000 at some epochs and loses Balloon Boy at
 * others, and until now the phone has DRAWN its epoch: the executor released
 * the schedule when a ~1 Hz screenshot classifier called the office, which
 * brackets the night's start by seconds. Placing the release at a chosen
 * offset needs the onset at frame resolution, and this service already
 * classifies every captured frame. So the service keeps the answer instead of
 * a host re-deriving it through 140-240 ms reads.
 *
 * The rule is the post-hoc one in packages/adapters night-onset.js (and
 * packages/propose/bin/report/phase-reconstruct.mjs): the onset is the first frame of the
 * first run of FNAF2_NIGHT identities that spans at least HOLD_NS of image
 * time. Any other identity before the hold is met restarts the run, so a
 * single-frame flicker is never an onset. Once latched it stays latched for
 * the capture generation; a new generation calls reset(). The campaign's
 * preflight restarts capture, so every attempt starts a generation, and the
 * host refuses an onset older than its own intro as a second guard.
 *
 * It deliberately does NOT re-arm on FNAF2_MENU. An earlier version did, on
 * the belief that the menu identity only appears between nights; night5-anchor2's
 * frame trace has 520 FNAF2_MENU frames inside the night, in runs of up to
 * 3430 ms on the opening's camera views, so that re-arm cleared a latched
 * onset mid-night and re-latched a later, wrong one.
 *
 * Pure Java: no Android types, so android/companion/test.sh exercises it on
 * the host.
 */
final class NightOnsetLatch {
    static final long HOLD_NS = 500_000_000L;
    static final long NOT_LATCHED = -1L;

    private long candidateNs = NOT_LATCHED;
    private long lastImageNs = NOT_LATCHED;
    private long onsetNs = NOT_LATCHED;

    synchronized void reset() {
        candidateNs = NOT_LATCHED;
        lastImageNs = NOT_LATCHED;
        onsetNs = NOT_LATCHED;
    }

    /** Feed one captured frame in capture order. */
    synchronized void onFrame(long imageNs, int identity) {
        if (imageNs <= 0L || onsetNs != NOT_LATCHED) return;
        // Image timestamps are monotonic per generation; a frame that goes
        // backwards cannot extend or start a run, it is ignored.
        if (lastImageNs != NOT_LATCHED && imageNs <= lastImageNs) return;
        lastImageNs = imageNs;
        if (identity != ScreenIdentity.FNAF2_NIGHT) {
            candidateNs = NOT_LATCHED;
            return;
        }
        if (candidateNs == NOT_LATCHED) candidateNs = imageNs;
        if (imageNs - candidateNs >= HOLD_NS) onsetNs = candidateNs;
    }

    /** The latched onset's image time, or NOT_LATCHED. */
    synchronized long onsetNs() {
        return onsetNs;
    }
}
