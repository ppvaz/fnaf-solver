package com.ppvaz.fnafcompanion;

/**
 * What the FNaF 1 teach panel says while the grid420 route plays 4/20.
 *
 * <p>The route lives on three roll clocks that start with the night: Bonnie
 * every 4970 ms, Chica every 4980 ms and Foxy every 5010 ms [fnaf1.js ROLLS,
 * g318/g319/g321]. The host names the night's origin once, on this helper's
 * own image clock, and the panel draws those clocks from it with no further
 * help. Beside them it shows the step the route is on and why, and the last
 * thing each doorway showed -- each a word from the fixed vocabulary below,
 * never host-supplied text, so a caller cannot put arbitrary copy over the
 * game.</p>
 *
 * <p>The panel paints only inside {@link #LEFT}..{@link #RIGHT} x
 * {@link #TOP}..{@link #BOTTOM}, which every FNaF 1 native region the route
 * reads clears by {@link #GUARD_PX} (packages/play/profiles/fnaf1/moto-g56/regions-fnaf1-*.json;
 * apps/desktop/test/test-native-regions.mjs checks it).</p>
 *
 * <p>Pure Java: no Android types, so android/companion/test.sh runs it on the
 * host.</p>
 */
public final class Fnaf1Lesson {
    public static final String VERSION = "fnaf1-teach-v1";
    /** Native 2400x1080 content pixels, [left, right) x [top, bottom). */
    public static final int LEFT = 560;
    public static final int TOP = 110;
    public static final int RIGHT = 1340;
    public static final int BOTTOM = 330;
    public static final int WIDTH = RIGHT - LEFT;
    public static final int HEIGHT = BOTTOM - TOP;
    public static final int GUARD_PX = 10;

    public static final long BONNIE_MS = 4970;
    public static final long CHICA_MS = 4980;
    public static final long FOXY_MS = 5010;
    /** 12 AM lasts 90 s and every later hour 89 s [g397-g400]; 6 AM at 535 s. */
    public static final long NIGHT_MS = 535_000;

    public enum Step {
        SETUP("Selecting CAM 4B",
                "With 4B on screen, Freddy can never get in."),
        FLICK("CAM 4B flick before Foxy's tick",
                "A raised camera reloads his wait: his tick fails."),
        CHECK_LEFT("Left light just after Bonnie's tick",
                "He can only reach the door on his own tick."),
        CHECK_RIGHT("Right light just after Chica's tick",
                "She can only reach the door on her own tick."),
        CLOSE_LEFT("Shutting left before his next tick",
                "Shut at the tick: Bonnie goes back to 1B."),
        CLOSE_RIGHT("Shutting right before her next tick",
                "Shut at the tick: Chica goes back to 4A."),
        REOPEN_LEFT("Light through the shut door; empty: open",
                "At 20 he always moves: after the tick, he left."),
        REOPEN_RIGHT("Light through the window; empty: open",
                "At 20 she always moves: after the tick, she left."),
        WAIT("Waiting for the next tick",
                "Between ticks, nobody moves.");

        public final String title;
        public final String why;

        Step(String title, String why) {
            this.title = title;
            this.why = why;
        }
    }

    public enum Seen { UNKNOWN, CLEAR, OCCUPIED }

    public enum Door { UNKNOWN, OPEN, SHUT }

    private long originNs = -1;
    private Step step = Step.WAIT;
    private Seen seenLeft = Seen.UNKNOWN;
    private Seen seenRight = Seen.UNKNOWN;
    private Door doorLeft = Door.UNKNOWN;
    private Door doorRight = Door.UNKNOWN;

    /**
     * Apply one {@code f1} command: {@code origin <ns>}, {@code step <STEP>},
     * {@code seen <L|R> <CLEAR|OCCUPIED>}, {@code door <L|R> <OPEN|SHUT>}.
     * Anything else is refused whole.
     */
    public synchronized void apply(String[] field, int from) {
        if (field.length <= from) throw new IllegalArgumentException("f1-usage");
        String verb = field[from];
        switch (verb) {
            case "origin":
                if (field.length != from + 2 || !field[from + 1].matches("[0-9]{1,19}")) {
                    throw new IllegalArgumentException("f1-origin-usage");
                }
                originNs = Long.parseLong(field[from + 1]);
                return;
            case "step":
                if (field.length != from + 2) throw new IllegalArgumentException("f1-step-usage");
                step = Step.valueOf(field[from + 1]);
                return;
            case "seen":
            case "door": {
                if (field.length != from + 3) throw new IllegalArgumentException("f1-side-usage");
                boolean left = side(field[from + 1]);
                if (verb.equals("seen")) {
                    Seen value = Seen.valueOf(field[from + 2]);
                    if (left) seenLeft = value; else seenRight = value;
                } else {
                    Door value = Door.valueOf(field[from + 2]);
                    if (left) doorLeft = value; else doorRight = value;
                }
                return;
            }
            default:
                throw new IllegalArgumentException("f1-usage");
        }
    }

    private static boolean side(String value) {
        if ("L".equals(value)) return true;
        if ("R".equals(value)) return false;
        throw new IllegalArgumentException("f1-side");
    }

    public synchronized long originNs() { return originNs; }
    public synchronized Step step() { return step; }
    public synchronized Seen seen(boolean left) { return left ? seenLeft : seenRight; }
    public synchronized Door door(boolean left) { return left ? doorLeft : doorRight; }

    /** Night milliseconds at {@code nowNs}, or -1 before an origin. */
    public synchronized long nightMs(long nowNs) {
        return originNs < 0 ? -1 : (nowNs - originNs) / 1_000_000L;
    }

    /**
     * Fraction of the way through the current period of a roll clock, 0..1,
     * where 1 is the next roll. The first fire is one period after the
     * night's first frame [passEvery], so the grid is k * period.
     */
    public static double phase(long nightMs, long periodMs) {
        if (nightMs < 0) return 0;
        return (nightMs % periodMs) / (double) periodMs;
    }

    /** Milliseconds until the next roll of a clock. */
    public static long untilNext(long nightMs, long periodMs) {
        if (nightMs < 0) return periodMs;
        return periodMs - nightMs % periodMs;
    }

    /** The HUD hour at a night time: "12 AM" .. "6 AM". */
    public static String hour(long nightMs) {
        if (nightMs < 90_000) return "12 AM";
        long h = 1 + (nightMs - 90_000) / 89_000;
        return Math.min(6, h) + " AM";
    }

    public static String word(Seen seen) {
        switch (seen) {
            case CLEAR: return "empty";
            case OCCUPIED: return "OCCUPIED";
            default: return "?";
        }
    }

    public static String word(Door door) {
        switch (door) {
            case OPEN: return "open";
            case SHUT: return "SHUT";
            default: return "?";
        }
    }
}
