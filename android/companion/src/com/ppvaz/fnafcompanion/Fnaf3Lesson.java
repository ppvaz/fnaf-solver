package com.ppvaz.fnafcompanion;

/**
 * What the FNaF 3 teach panel says while the loop plays a night.
 *
 * <p>FNaF 3 is a pursuit. One animatronic, Springtrap, walks the building's
 * ten cameras and five vents toward the office; the player stays on the
 * monitor, finds him, and keeps him out: a seal on the vent beside him (one
 * vent at a time, and the map must stay open while it charges), an audio lure
 * that pulls him back a room and resets his move counter, and reboots when
 * the audio, camera or ventilation system fails. The host names the step,
 * the camera on screen, where he was last seen, the sealed vent, the last
 * lure and each system's state; the panel draws his clock from the origin.
 * Every word is from the fixed vocabulary below, never host-supplied text,
 * so a caller cannot put arbitrary copy over the game.</p>
 *
 * <p>The panel paints only inside {@link #LEFT}..{@link #RIGHT} x
 * {@link #TOP}..{@link #BOTTOM}, the band above the monitor that every FNaF 3
 * native region the loop reads clears by {@link #GUARD_PX}
 * (tools/device/models/regions-fnaf3-*.json; tools/device/test-native-regions.mjs
 * checks it).</p>
 *
 * <p>Pure Java: no Android types, so android/companion/test.sh runs it on the
 * host.</p>
 */
public final class Fnaf3Lesson {
    public static final String VERSION = "fnaf3-teach-v1";
    /** Native 2400x1080 content pixels, [left, right) x [top, bottom). */
    public static final int LEFT = 320;
    public static final int TOP = 4;
    public static final int RIGHT = 2130;
    public static final int BOTTOM = 120;
    public static final int WIDTH = RIGHT - LEFT;
    public static final int HEIGHT = BOTTOM - TOP;
    public static final int GUARD_PX = 10;

    /** His move counter ticks every second (g221; twice as fast under Aggressive, g222). */
    public static final long TICK_MS = 1000;

    public enum Step {
        SWEEP("Sweeping the cameras",
                "Only the camera he is on tells you where he is."),
        WATCH("Watching him",
                "Each second his counter climbs; a move can come any tick."),
        SEAL("Sealing the vent beside him",
                "One vent at a time: the map stays open until the bar turns red."),
        LURE("Playing audio to pull him back",
                "A lure next to him draws him a room away and resets his counter."),
        VENTS("Checking the vents",
                "Vents 14 and 15 open straight into the office."),
        REBOOT_VENT("Rebooting ventilation",
                "Left broken, the air fails, the office blacks out and he comes in."),
        REBOOT_AUDIO("Rebooting audio",
                "Without audio there is no lure."),
        REBOOT_CAMERA("Rebooting the cameras",
                "Without cameras you cannot see where he is."),
        REBOOT_ALL("Rebooting everything",
                "Slower than one system: 10-20 s against 5-10 s."),
        PHANTOM("A phantom: looking away",
                "Looking at a phantom sets it off, and its scare breaks a system.");

        public final String title;
        public final String why;

        Step(String title, String why) {
            this.title = title;
            this.why = why;
        }
    }

    public enum Sys { OK, ERROR, REBOOT }

    /** The three systems, in the maintenance panel's order. */
    public enum System3 { AUDIO, CAMERA, VENT }

    /** The night's difficulty: AI per night (g649-g654) and the Aggressive cheat (g222). */
    public static int ai(int night) {
        if (night <= 1) return 0;
        if (night <= 5) return night;
        return 7;
    }

    /**
     * His mean seconds between moves at an AI, from the rule (fnaf3.js SPRINGTRAP):
     * the counter gains one a second (two under Aggressive) and he moves when it
     * passes {@code (10 - AI - aggression) + Random(15)}. Aggression is set
     * through the first hour and from 4 AM (g904), so this is the aggressive row.
     */
    public static double meanMoveS(int ai, boolean aggressive) {
        int base = 10 - ai - 1;
        int step = aggressive ? 2 : 1;
        double alive = 1.0;
        double mean = 0;
        for (int t = 1; t <= 200 && alive > 1e-9; t++) {
            double p = Math.min(1.0, Math.max(0.0, (step * t - base) / 15.0));
            mean += t * alive * p;
            alive *= 1 - p;
        }
        return mean;
    }

    private long originNs = -1;
    private int night = 0;
    private boolean aggressive = false;
    private Step step = Step.SWEEP;
    private long stepSinceNs = -1;
    private int look = 0;
    private int seen = 0;
    private long seenNs = -1;
    private int sealed = 0;
    private int lure = 0;
    private long lureNs = -1;
    private final Sys[] sys = { Sys.OK, Sys.OK, Sys.OK };

    /**
     * Apply one {@code f3} command: {@code origin <ns>}, {@code night <1..6> <NORMAL|AGGRESSIVE>},
     * {@code step <STEP>}, {@code look <1..15|OFF>}, {@code seen <1..15|NONE>},
     * {@code sealed <11..15|NONE>}, {@code lure <1..10>},
     * {@code sys <AUDIO|CAMERA|VENT> <OK|ERROR|REBOOT>}. Anything else is refused
     * whole. {@code nowNs} stamps a step, a sighting and a lure.
     */
    public synchronized void apply(String[] field, int from, long nowNs) {
        if (field.length <= from) throw new IllegalArgumentException("f3-usage");
        String verb = field[from];
        switch (verb) {
            case "origin":
                if (field.length != from + 2 || !field[from + 1].matches("[0-9]{1,19}")) {
                    throw new IllegalArgumentException("f3-origin-usage");
                }
                originNs = Long.parseLong(field[from + 1]);
                return;
            case "night":
                if (field.length != from + 3 || !field[from + 1].matches("[1-6]")) {
                    throw new IllegalArgumentException("f3-night-usage");
                }
                if (!"NORMAL".equals(field[from + 2]) && !"AGGRESSIVE".equals(field[from + 2])) {
                    throw new IllegalArgumentException("f3-night-usage");
                }
                night = Integer.parseInt(field[from + 1]);
                aggressive = "AGGRESSIVE".equals(field[from + 2]);
                return;
            case "step": {
                if (field.length != from + 2) throw new IllegalArgumentException("f3-step-usage");
                Step next = Step.valueOf(field[from + 1]);
                if (next != step) stepSinceNs = nowNs;
                step = next;
                return;
            }
            case "look":
                look = camera(field, from, 1, 15, "OFF", "f3-look-usage");
                return;
            case "seen":
                seen = camera(field, from, 1, 15, "NONE", "f3-seen-usage");
                seenNs = seen == 0 ? -1 : nowNs;
                return;
            case "sealed":
                sealed = camera(field, from, 11, 15, "NONE", "f3-sealed-usage");
                return;
            case "lure":
                lure = camera(field, from, 1, 10, null, "f3-lure-usage");
                lureNs = nowNs;
                return;
            case "sys":
                if (field.length != from + 3) throw new IllegalArgumentException("f3-sys-usage");
                sys[System3.valueOf(field[from + 1]).ordinal()] = Sys.valueOf(field[from + 2]);
                return;
            default:
                throw new IllegalArgumentException("f3-usage");
        }
    }

    private static int camera(String[] field, int from, int lo, int hi, String none, String usage) {
        if (field.length != from + 2) throw new IllegalArgumentException(usage);
        String value = field[from + 1];
        if (none != null && none.equals(value)) return 0;
        if (!value.matches("[0-9]{1,2}")) throw new IllegalArgumentException(usage);
        int n = Integer.parseInt(value);
        if (n < lo || n > hi) throw new IllegalArgumentException(usage);
        return n;
    }

    public synchronized long originNs() { return originNs; }
    public synchronized int night() { return night; }
    public synchronized boolean aggressive() { return aggressive; }
    public synchronized Step step() { return step; }
    public synchronized int look() { return look; }
    public synchronized int seen() { return seen; }
    public synchronized int sealed() { return sealed; }
    public synchronized int lure() { return lure; }
    public synchronized Sys sys(System3 which) { return sys[which.ordinal()]; }

    /** Milliseconds since he was last seen, or -1. */
    public synchronized long seenAgoMs(long nowNs) {
        return seenNs < 0 ? -1 : (nowNs - seenNs) / 1_000_000L;
    }

    /** Milliseconds since the last lure, or -1. */
    public synchronized long lureAgoMs(long nowNs) {
        return lureNs < 0 ? -1 : (nowNs - lureNs) / 1_000_000L;
    }

    /** Milliseconds the current step has run at {@code nowNs}, or -1 if unknown. */
    public synchronized long stepMs(long nowNs) {
        return stepSinceNs < 0 ? -1 : (nowNs - stepSinceNs) / 1_000_000L;
    }

    /** Night milliseconds at {@code nowNs}, or -1 before an origin. */
    public synchronized long nightMs(long nowNs) {
        return originNs < 0 ? -1 : (nowNs - originNs) / 1_000_000L;
    }

    /** Night 1's hour is 40 s (g642), every later night's 60 s (g644). */
    public static long hourMs(int night) {
        return night <= 1 ? 40_000 : 60_000;
    }

    /** The HUD hour. */
    public static String hour(long nightMs, int night) {
        long h = hourMs(night);
        if (nightMs < h) return "12 AM";
        return Math.min(6, nightMs / h) + " AM";
    }

    /** Fraction of the way to the next tick of a clock, 0..1. */
    public static double phase(long nightMs, long periodMs) {
        if (nightMs < 0) return 0;
        return (nightMs % periodMs) / (double) periodMs;
    }

    /** The vent a camera leads into (fnaf3.js VENTS: every entrance is on branch 4), or 0. */
    public static int ventFrom(int cam) {
        switch (cam) {
            case 10: return 14;
            case 2: return 15;
            case 9: return 11;
            case 7: return 12;
            case 5: return 13;
            default: return 0;
        }
    }

    /** Vents 14 and 15 bypass the attack chain and kill outright; 11 and 12 enter it two steps out. */
    public static boolean lethal(int vent) {
        return vent == 14 || vent == 15;
    }

    public static String word(Sys value) {
        switch (value) {
            case ERROR: return "ERROR";
            case REBOOT: return "rebooting";
            default: return "ok";
        }
    }

    public static String cam(int n) {
        return n <= 0 ? "?" : String.format(java.util.Locale.ROOT, "CAM %02d", n);
    }
}
