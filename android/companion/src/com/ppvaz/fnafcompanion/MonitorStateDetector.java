package com.ppvaz.fnafcompanion;

/**
 * LEGACY (FNaF 2): the helper's own {@code monitorUp} fact on FNaF 2 frames,
 * from the paired native control strokes. {@code packages/adapters}
 * monitor-rule.js takes an explicit {@code monitorUp} before its grid-fitted
 * fallback, so this is live in the FNaF 2 night lane. The grid-fitted
 * {@code measure()} that used to sit beside it had no caller and left on
 * 2026-09-27.
 */
public final class MonitorStateDetector {
    public static final String SCHEMA = "monitor-rule-v1";
    public static final String PROFILE_ID = "moto-g56-v207-landscape";

    public enum State {
        UNKNOWN,
        UP,
        DOWN
    }

    public static final class Result {
        public final State state;
        public final String reason;

        private Result(State state, String reason) {
            this.state = state;
            this.reason = reason;
        }

        public boolean observed() {
            return state == State.UP || state == State.DOWN;
        }
    }

    private MonitorStateDetector() {
    }

    /**
     * Adapt the already-measured native bottom-control strokes to the monitor
     * fact FRAME serves to the FNaF 2 lane. This performs no pixel
     * reads and intentionally has no fitted-grid fallback: the live path has
     * one state source.
     */
    public static Result fromNativeControlStrokes(int screenIdentity,
            int maskDownstroke, int monitorDownstroke) {
        if (screenIdentity != ScreenIdentity.FNAF2_NIGHT) {
            return unknown("screen-identity");
        }
        switch (PixelWatch.controlState(maskDownstroke, monitorDownstroke)) {
            case MONITOR_UP:
                return observed(State.UP, "native-stroke-monitor-up");
            case MASK_ON:
                return observed(State.DOWN, "native-stroke-mask-on");
            case OFFICE_UNMASKED:
                return observed(State.DOWN, "native-stroke-office");
            case UNKNOWN:
            default:
                return unknown("native-stroke-ambiguous");
        }
    }

    private static Result observed(State state, String reason) {
        return new Result(state, reason);
    }

    private static Result unknown(String reason) {
        return new Result(State.UNKNOWN, reason);
    }
}
