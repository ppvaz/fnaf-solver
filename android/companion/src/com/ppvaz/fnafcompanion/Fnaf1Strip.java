package com.ppvaz.fnafcompanion;

/**
 * What the FNaF 1 Night 1 and 2 teaching strip says while the community loop
 * plays: one line naming the night and the route's stage, and one line of why.
 *
 * <p>It lived in a second APK, android/fnaf1-teach, from 2026-09-25 until
 * 2026-10-01, when it moved here: everything that runs on the phone lives in
 * the Companion. The host names a night, a stage and a run id; every word
 * shown comes from the fixed vocabulary below, never from the host.</p>
 *
 * <p>The strip paints only inside {@link #LEFT}..{@link #RIGHT} x
 * {@link #TOP}..{@link #BOTTOM}. It ends at native y=50 and FNaF 1's door-light
 * reader starts at y=60 (fnaf1-door-light.py), so {@link #GUARD_PX} remains
 * even when a screenshot includes application overlays
 * (packages/play/games/fnaf1/test-fnaf1-teach-overlay.py checks it against the
 * reader, the title gate and every measured control).</p>
 *
 * <p>Pure Java: no Android types, so android/companion/test.sh runs it on the
 * host.</p>
 */
public final class Fnaf1Strip {
    public static final String SCHEMA = "fnaf1-teach-overlay-v2";
    /** Native 2400x1080 content pixels, [left, right) x [top, bottom). */
    public static final int LEFT = 20;
    public static final int TOP = 0;
    public static final int RIGHT = 1020;
    public static final int BOTTOM = 50;
    public static final int GUARD_PX = 10;

    static final String[] STAGES = {
            "hands-off", "left-calibration", "left-watch", "right-monitor-calibration",
            "full-loop", "night2-calibration",
    };

    private int night = 1;
    private String stage = "hands-off";
    private String run = "none";

    public static boolean validNight(int night) {
        return night == 1 || night == 2;
    }

    public static boolean validStage(String stage) {
        for (String known : STAGES) {
            if (known.equals(stage)) return true;
        }
        return false;
    }

    public static boolean validRun(String run) {
        return run != null && run.matches("[a-z0-9][a-z0-9-]{0,95}");
    }

    public static String headline(int night, String stage) {
        return "FNaF 1  •  Night " + night + "  •  " + stage;
    }

    public static String lesson(String stage) {
        switch (stage) {
            case "hands-off":
                return "12–2 AM: no character can move; preserve power while the clock advances.";
            case "left-calibration":
                return "2 AM setup: learn the left doorway's lit reference before Bonnie can advance.";
            case "left-watch":
                return "2–3 AM: check only the left doorway; Bonnie is the only active threat.";
            case "right-monitor-calibration":
                return "Before 3 AM: prepare right-door and monitor checks, then begin the full loop.";
            case "full-loop":
                return "Full loop: light each doorway, close on uncertainty, refresh cameras briefly.";
            case "night2-calibration":
                return "Night 2 begins active: establish both doorway references before the loop.";
            default:
                throw new IllegalArgumentException("unknown stage " + stage);
        }
    }

    /**
     * {@code show <night> <stage> <run>} from {@code field[from]}: null when
     * applied, else the refusal, and a refused command changes nothing.
     */
    public synchronized String apply(String[] field, int from) {
        if (field.length != from + 4 || !"show".equals(field[from])) return "f1strip-usage";
        int nextNight;
        try {
            nextNight = Integer.parseInt(field[from + 1]);
        } catch (NumberFormatException notANumber) {
            return "f1strip-night";
        }
        if (!validNight(nextNight)) return "f1strip-night";
        if (!validStage(field[from + 2])) return "f1strip-stage";
        if (!validRun(field[from + 3])) return "f1strip-run";
        night = nextNight;
        stage = field[from + 2];
        run = field[from + 3];
        return null;
    }

    public synchronized String headline() {
        return headline(night, stage);
    }

    public synchronized String lesson() {
        return lesson(stage);
    }

    /** The status reply's fields after {@code OK }: the run's state, never free text. */
    public synchronized String status(boolean attached, boolean permission) {
        return "f1strip=" + (attached ? "ATTACHED" : "NONE")
                + " schema=" + SCHEMA
                + " permission=" + (permission ? "GRANTED" : "DENIED")
                + " interactive=false"
                + " rect=" + LEFT + "," + TOP + "," + RIGHT + "," + BOTTOM
                + " night=" + night + " stage=" + stage + " run=" + run;
    }
}
