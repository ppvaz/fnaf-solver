package com.ppvaz.fnafcompanion;

/**
 * What the FNaF 4 teach panel says while the community loop plays a night.
 *
 * <p>The loop is: listen at the left door, then the right, turn to the bed,
 * then the closet. At a door, breathing means Bonnie or Chica is right
 * outside -- hold the door -- and silence means the hall is safe to light,
 * which pushes anyone further down it home. The bed light drains Freddy's
 * meter; the closet is where Foxy hides. The host names the step, what each
 * station last showed, and the night's origin once; the panel draws the
 * game's own clocks from the origin: Bonnie, Chica and Foxy roll every 5 s,
 * Freddy's meter ticks every 4 s [fnaf4.js ROLLS, g236/g284/g285/g397], the
 * hour lasts 60 s [g568]. Every word is from the fixed vocabulary below, never
 * host-supplied text, so a caller cannot put arbitrary copy over the game.</p>
 *
 * <p>The panel paints only inside {@link #LEFT}..{@link #RIGHT} x
 * {@link #TOP}..{@link #BOTTOM}, which every FNaF 4 native region the loop
 * reads clears by {@link #GUARD_PX} (packages/play/profiles/fnaf4/moto-g56/regions-fnaf4-*.json;
 * apps/desktop/test/test-native-regions.mjs checks it).</p>
 *
 * <p>Pure Java: no Android types, so android/companion/test.sh runs it on the
 * host.</p>
 */
public final class Fnaf4Lesson {
    public static final String VERSION = "fnaf4-teach-v1";
    /** Native 2400x1080 content pixels, [left, right) x [top, bottom). */
    public static final int LEFT = 440;
    public static final int TOP = 8;
    public static final int RIGHT = 1960;
    public static final int BOTTOM = 188;
    public static final int WIDTH = RIGHT - LEFT;
    public static final int HEIGHT = BOTTOM - TOP;
    public static final int GUARD_PX = 10;

    public static final long ROLL_MS = 5000;
    public static final long FREDDY_MS = 4000;
    public static final long HOUR_MS = 60_000;

    public enum Step {
        LISTEN_LEFT("Listening at the left door",
                "Breathing means Bonnie is right outside."),
        LISTEN_RIGHT("Listening at the right door",
                "Breathing means Chica is right outside."),
        HOLD_LEFT("Breathing: holding the left door",
                "Each 3 s tick with it shut can send him back."),
        HOLD_RIGHT("Breathing: holding the right door",
                "Each 3 s tick with it shut can send her back."),
        FLASH_LEFT("Silent: lighting the left hall",
                "Light sends anyone down the hall home."),
        FLASH_RIGHT("Silent: lighting the right hall",
                "Light sends anyone down the hall home."),
        BED("Lighting the bed",
                "The light drains Freddy's meter 20 a second."),
        CLOSET("Checking the closet",
                "Foxy hides here once he gets past a door."),
        CLOSET_HOLD("Foxy inside: holding the closet shut",
                "Every second shut sets him back a step."),
        WALK("On the way",
                "The doors, then the closet, then the bed."),
        STEPS_LEFT("Footsteps: holding the left door",
                "Someone walking up is not breathing yet: never light."),
        STEPS_RIGHT("Footsteps: holding the right door",
                "Someone walking up is not breathing yet: never light."),
        BED_WAITS("The bed waits: a door still breathes",
                "Turning to the bed with him there is what kills."),
        FB_HOLD_LEFT("He landed left: holding the left door",
                "A shut door sends him to the other side on a 3 s tick."),
        FB_HOLD_RIGHT("He landed right: holding the right door",
                "A shut door sends him to the other side on a 3 s tick."),
        FB_SWITCH("He ran across: switching doors",
                "Every change of side makes a sound; the hall step is silent."),
        FB_BED("A laugh: lighting the bed",
                "Two seconds of light send him off the bed."),
        FB_CLOSET("Then holding the closet shut",
                "A shut closet pushes him out on a 3 s tick."),
        FB_MOVE("Moving before stillness gets me",
                "Standing still 25 s lets him strike from anywhere."),
        /* Nothing of his heard yet: said as such, never as a landing (n5b's
           panel read "He landed left" over a blind default all night). */
        FB_LISTEN("Listening for his first move",
                "He starts in the middle; every change of side is a sound."),
        FB_GUESS_LEFT("Not heard: guessing the left door",
                "No landing heard, so this door is a guess, not a fact."),
        FB_GUESS_RIGHT("Not heard: guessing the right door",
                "No landing heard, so this door is a guess, not a fact.");

        public final String title;
        public final String why;

        Step(String title, String why) {
            this.title = title;
            this.why = why;
        }
    }

    public enum Door { UNKNOWN, CLEAR, BREATH, STEPS, HALL, SHUT }

    public enum Closet { UNKNOWN, EMPTY, FOXY }

    public enum Bed { UNKNOWN, CLEAR, FREDDLES }

    /**
     * His nights: off; Fredbear (Nights 5-6: 3 s moves, 30 s room window);
     * Nightmare (Night 7, shadow 1) and Nightmare at 20/20/20/20 (Night 8,
     * shadow 2): 2 s moves, 20 s window. The kill windows are the game's own
     * counters (fnaf4.js FREDBEAR av19 / av6): in a hall 15 / 10 / 8 s, in the
     * bed or closet 20 / 20 / 11 s.
     */
    public enum Fred {
        OFF(0, 0), FREDBEAR(15, 20), NIGHTMARE(10, 20), NIGHTMARE_MAX(8, 11);

        public final int hallS;
        public final int roomS;

        Fred(int hallS, int roomS) {
            this.hallS = hallS;
            this.roomS = roomS;
        }

        public boolean nightmare() { return this == NIGHTMARE || this == NIGHTMARE_MAX; }
    }

    /** Where he was last heard landing, or the room after a laugh. */
    public enum FredAt { UNKNOWN, LEFT, RIGHT, ROOM }

    /** The last sound of his the host heard. */
    public enum Heard { NONE, RAN_LEFT, RAN_RIGHT, LAUGH }

    public static final long FREDBEAR_ROLL_MS = 3000;     // g286
    public static final long NIGHTMARE_ROLL_MS = 2000;    // g287, shadow >= 1
    public static final long FREDBEAR_ROOM_MS = 30000;    // g3844, the teleport's clock
    public static final long NIGHTMARE_ROOM_MS = 20000;
    /** Standing still this long arms the black flash on his nights (g566/g564). */
    public static final long STILL_MS = 25000;

    /** Where the player is: the four stations, or between them. */
    public enum Station { LEFT, RIGHT, BED, CLOSET, WALK }

    /** The listening meter's bar, in hundredths of the breathing NCC (host's detector, fnaf4-cues.py). */
    public static final int LEVEL_DOUBT = 30;
    public static final int LEVEL_BREATH = 38;
    /**
     * A held door dismisses on the game's 3000 ms tick (g342) only once it
     * reads shut, which the close animation reaches 733 ms in (g337, the
     * animation bank): a hold has done its job 3733 ms after it starts.
     */
    public static final long DISMISS_MS = 3733;
    /** The bed is due this long after the last bed light (Freddy's meter, g397). */
    public static final long BED_DUE_MS = 35000;

    private long originNs = -1;
    private Step step = Step.WALK;
    private long stepSinceNs = -1;
    private Door left = Door.UNKNOWN;
    private Door right = Door.UNKNOWN;
    private Closet closet = Closet.UNKNOWN;
    private Bed bed = Bed.UNKNOWN;
    private int level = -1;
    private int cover = -1;
    private long bedLitNs = -1;
    private Fred fred = Fred.OFF;
    private FredAt fredAt = FredAt.UNKNOWN;
    private Heard heard = Heard.NONE;
    private long heardNs = -1;
    private long ranNs = -1;

    /**
     * Apply one {@code f4} command: {@code origin <ns>}, {@code step <STEP>},
     * {@code door <L|R> <CLEAR|BREATH|HALL|SHUT>}, {@code closet <EMPTY|FOXY>},
     * {@code bed <CLEAR|FREDDLES>}, {@code level <0..100|OFF>}. Anything else
     * is refused whole. {@code nowNs} stamps a step change so the panel can
     * show how long a hold has run.
     */
    public synchronized void apply(String[] field, int from, long nowNs) {
        if (field.length > from && "fb".equals(field[from])) {
            applyFred(field, from, nowNs);
            return;
        }
        if (field.length == from + 1 && "bedlit".equals(field[from])) {
            bedLitNs = nowNs;
            return;
        }
        if (field.length > from && "step".equals(field[from])) {
            if (field.length != from + 2) throw new IllegalArgumentException("f4-step-usage");
            Step next = Step.valueOf(field[from + 1]);
            if (next != step) stepSinceNs = nowNs;
            step = next;
            return;
        }
        apply(field, from);
    }

    public synchronized void apply(String[] field, int from) {
        if (field.length <= from) throw new IllegalArgumentException("f4-usage");
        String verb = field[from];
        switch (verb) {
            case "origin":
                if (field.length != from + 2 || !field[from + 1].matches("[0-9]{1,19}")) {
                    throw new IllegalArgumentException("f4-origin-usage");
                }
                originNs = Long.parseLong(field[from + 1]);
                return;
            case "step":
                if (field.length != from + 2) throw new IllegalArgumentException("f4-step-usage");
                step = Step.valueOf(field[from + 1]);
                return;
            case "cover":
                // How much of the breath a quiet verdict needs the listen has covered, 0..100.
                if (field.length != from + 2) throw new IllegalArgumentException("f4-cover-usage");
                if ("OFF".equals(field[from + 1])) { cover = -1; return; }
                if (!field[from + 1].matches("[0-9]{1,3}")) throw new IllegalArgumentException("f4-cover-usage");
                int covered = Integer.parseInt(field[from + 1]);
                if (covered > 100) throw new IllegalArgumentException("f4-cover-range");
                cover = covered;
                return;
            case "level":
                if (field.length != from + 2) throw new IllegalArgumentException("f4-level-usage");
                if ("OFF".equals(field[from + 1])) { level = -1; return; }
                if (!field[from + 1].matches("[0-9]{1,3}")) throw new IllegalArgumentException("f4-level-usage");
                int parsed = Integer.parseInt(field[from + 1]);
                if (parsed > 100) throw new IllegalArgumentException("f4-level-range");
                level = parsed;
                return;
            case "door": {
                if (field.length != from + 3) throw new IllegalArgumentException("f4-door-usage");
                Door value = Door.valueOf(field[from + 2]);
                if ("L".equals(field[from + 1])) left = value;
                else if ("R".equals(field[from + 1])) right = value;
                else throw new IllegalArgumentException("f4-side");
                return;
            }
            case "closet":
                if (field.length != from + 2) throw new IllegalArgumentException("f4-closet-usage");
                closet = Closet.valueOf(field[from + 1]);
                return;
            case "bed":
                if (field.length != from + 2) throw new IllegalArgumentException("f4-bed-usage");
                bed = Bed.valueOf(field[from + 1]);
                return;
            default:
                throw new IllegalArgumentException("f4-usage");
        }
    }

    /**
     * {@code fb mode <OFF|FREDBEAR|NIGHTMARE>}, {@code fb at <UNKNOWN|LEFT|RIGHT|ROOM>},
     * {@code fb heard <RAN_LEFT|RAN_RIGHT|LAUGH>} (stamped now), {@code fb ran}
     * (a walk just reset his stillness counter, stamped now).
     */
    private void applyFred(String[] field, int from, long nowNs) {
        if (field.length < from + 2) throw new IllegalArgumentException("f4-fb-usage");
        String what = field[from + 1];
        switch (what) {
            case "mode":
                if (field.length != from + 3) throw new IllegalArgumentException("f4-fb-usage");
                fred = Fred.valueOf(field[from + 2]);
                return;
            case "at":
                if (field.length != from + 3) throw new IllegalArgumentException("f4-fb-usage");
                fredAt = FredAt.valueOf(field[from + 2]);
                return;
            case "heard":
                if (field.length != from + 3) throw new IllegalArgumentException("f4-fb-usage");
                Heard value = Heard.valueOf(field[from + 2]);
                if (value == Heard.NONE) throw new IllegalArgumentException("f4-fb-heard");
                heard = value;
                heardNs = nowNs;
                return;
            case "ran":
                if (field.length != from + 2) throw new IllegalArgumentException("f4-fb-usage");
                ranNs = nowNs;
                return;
            default:
                throw new IllegalArgumentException("f4-fb-usage");
        }
    }

    public synchronized Fred fred() { return fred; }
    public synchronized FredAt fredAt() { return fredAt; }
    public synchronized Heard heard() { return heard; }

    /** Milliseconds since the last heard sound, or -1. */
    public synchronized long heardAgoMs(long nowNs) {
        return heardNs < 0 ? -1 : (nowNs - heardNs) / 1_000_000L;
    }

    /** Milliseconds since the last walk, or -1. */
    public synchronized long stillMs(long nowNs) {
        return ranNs < 0 ? -1 : (nowNs - ranNs) / 1_000_000L;
    }

    public static long rollMs(Fred fred) {
        return fred.nightmare() ? NIGHTMARE_ROLL_MS : FREDBEAR_ROLL_MS;
    }

    public static long roomMs(Fred fred) {
        return fred.nightmare() ? NIGHTMARE_ROOM_MS : FREDBEAR_ROOM_MS;
    }

    public static String name(Fred fred) {
        return fred.nightmare() ? "Nightmare" : "Fredbear";
    }

    public static String word(Heard value, Fred fred) {
        String who = name(fred);
        switch (value) {
            case RAN_LEFT: return who + " landed LEFT";
            case RAN_RIGHT: return who + " landed RIGHT";
            case LAUGH: return who + " LAUGHED";
            default: return "nothing yet";
        }
    }

    public synchronized long originNs() { return originNs; }
    public synchronized Step step() { return step; }
    public synchronized int level() { return level; }
    public synchronized int cover() { return cover; }

    /** Milliseconds until the bed is due, or Long.MIN_VALUE before the first bed light. */
    public synchronized long bedDueInMs(long nowNs) {
        return bedLitNs < 0 ? Long.MIN_VALUE : BED_DUE_MS - (nowNs - bedLitNs) / 1_000_000L;
    }

    /** Milliseconds the current step has run at {@code nowNs}, or -1 if unknown. */
    public synchronized long stepMs(long nowNs) {
        return stepSinceNs < 0 ? -1 : (nowNs - stepSinceNs) / 1_000_000L;
    }

    /** The station a step is taken at. */
    public static Station station(Step step) {
        switch (step) {
            case LISTEN_LEFT: case HOLD_LEFT: case FLASH_LEFT: case FB_HOLD_LEFT: case FB_GUESS_LEFT: case STEPS_LEFT:
                return Station.LEFT;
            case LISTEN_RIGHT: case HOLD_RIGHT: case FLASH_RIGHT: case FB_HOLD_RIGHT: case FB_GUESS_RIGHT: case STEPS_RIGHT:
                return Station.RIGHT;
            case BED: case FB_BED: return Station.BED;
            case CLOSET: case CLOSET_HOLD: case FB_CLOSET: return Station.CLOSET;
            default: return Station.WALK;
        }
    }

    /** A hold is a step that waits on the game's dismiss tick. */
    public static boolean isHold(Step step) {
        return step == Step.HOLD_LEFT || step == Step.HOLD_RIGHT || step == Step.CLOSET_HOLD
                || step == Step.FB_HOLD_LEFT || step == Step.FB_HOLD_RIGHT || step == Step.FB_CLOSET
                || step == Step.FB_GUESS_LEFT || step == Step.FB_GUESS_RIGHT
                || step == Step.STEPS_LEFT || step == Step.STEPS_RIGHT;
    }
    public synchronized Door door(boolean leftSide) { return leftSide ? left : right; }
    public synchronized Closet closet() { return closet; }
    public synchronized Bed bed() { return bed; }

    /** Night milliseconds at {@code nowNs}, or -1 before an origin. */
    public synchronized long nightMs(long nowNs) {
        return originNs < 0 ? -1 : (nowNs - originNs) / 1_000_000L;
    }

    /** Fraction of the way to the next tick of a clock, 0..1; the first tick is one period in. */
    public static double phase(long nightMs, long periodMs) {
        if (nightMs < 0) return 0;
        return (nightMs % periodMs) / (double) periodMs;
    }

    /** Milliseconds until the next tick of a clock. */
    public static long untilNext(long nightMs, long periodMs) {
        if (nightMs < 0) return periodMs;
        return periodMs - nightMs % periodMs;
    }

    /** The HUD hour: every hour is 60 s, 6 AM at 360 s. */
    public static String hour(long nightMs) {
        if (nightMs < HOUR_MS) return "12 AM";
        return Math.min(6, nightMs / HOUR_MS) + " AM";
    }

    public static String word(Door door) {
        switch (door) {
            case CLEAR: return "quiet";
            case BREATH: return "BREATHING";
            case STEPS: return "FOOTSTEPS";
            case HALL: return "someone down the hall";
            case SHUT: return "held shut";
            default: return "?";
        }
    }

    public static String word(Closet value) {
        switch (value) {
            case EMPTY: return "empty";
            case FOXY: return "FOXY";
            default: return "?";
        }
    }

    public static String word(Bed value) {
        switch (value) {
            case CLEAR: return "clear";
            case FREDDLES: return "FREDDLES";
            default: return "?";
        }
    }
}
