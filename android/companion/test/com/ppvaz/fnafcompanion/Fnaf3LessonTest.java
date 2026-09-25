package com.ppvaz.fnafcompanion;

/** Host-only contract for the FNaF 3 teach lesson: vocabulary, clocks, refusals. */
public final class Fnaf3LessonTest {
    private static int failures;

    private static void check(String what, boolean condition) {
        if (!condition) {
            System.out.println("FAIL " + what);
            failures++;
        }
    }

    private static boolean refuses(Fnaf3Lesson lesson, String... field) {
        try {
            lesson.apply(field, 0, 0L);
            return false;
        } catch (IllegalArgumentException expected) {
            return true;
        }
    }

    private static void apply(Fnaf3Lesson lesson, long nowNs, String... field) {
        lesson.apply(field, 0, nowNs);
    }

    public static void main(String[] args) {
        Fnaf3Lesson lesson = new Fnaf3Lesson();
        check("no origin, no night time", lesson.nightMs(123) == -1);
        apply(lesson, 0, "origin", "1000000000");
        check("night ms from the origin", lesson.nightMs(1_000_000_000L + 5_000_000_000L) == 5000);
        apply(lesson, 0, "night", "6", "NORMAL");
        check("a night", lesson.night() == 6 && !lesson.aggressive());
        apply(lesson, 0, "night", "6", "AGGRESSIVE");
        check("the Aggressive cheat", lesson.aggressive());
        check("night 7 is not a FNaF 3 night", refuses(lesson, "night", "7", "NORMAL"));
        check("a night needs its mode", refuses(lesson, "night", "5"));
        apply(lesson, 2_000_000_000L, "step", "SEAL");
        check("a named step", lesson.step() == Fnaf3Lesson.Step.SEAL);
        check("a step change is stamped", lesson.stepMs(3_500_000_000L) == 1500);
        apply(lesson, 9_000_000_000L, "step", "SEAL");
        check("the same step keeps its stamp", lesson.stepMs(9_000_000_000L) == 7000);
        check("host text is never a step", refuses(lesson, "step", "Hello"));

        apply(lesson, 0, "look", "10");
        check("the camera on screen", lesson.look() == 10);
        apply(lesson, 0, "look", "OFF");
        check("monitor down", lesson.look() == 0);
        apply(lesson, 4_000_000_000L, "seen", "14");
        check("a sighting in a vent", lesson.seen() == 14 && lesson.seenAgoMs(6_500_000_000L) == 2500);
        apply(lesson, 0, "seen", "NONE");
        check("no sighting has no age", lesson.seen() == 0 && lesson.seenAgoMs(1) == -1);
        check("camera 16 does not exist", refuses(lesson, "seen", "16"));
        check("camera 0 does not exist", refuses(lesson, "look", "0"));
        apply(lesson, 0, "sealed", "15");
        check("the sealed vent", lesson.sealed() == 15);
        check("only vents seal", refuses(lesson, "sealed", "10"));
        apply(lesson, 0, "sealed", "NONE");
        check("no seal", lesson.sealed() == 0);
        apply(lesson, 1_000_000_000L, "lure", "9");
        check("a lure is stamped", lesson.lure() == 9 && lesson.lureAgoMs(2_000_000_000L) == 1000);
        check("audio plays on cameras, not vents", refuses(lesson, "lure", "11"));
        check("a lure names a camera", refuses(lesson, "lure", "NONE"));

        apply(lesson, 0, "sys", "VENT", "ERROR");
        apply(lesson, 0, "sys", "AUDIO", "REBOOT");
        check("systems", lesson.sys(Fnaf3Lesson.System3.VENT) == Fnaf3Lesson.Sys.ERROR
                && lesson.sys(Fnaf3Lesson.System3.AUDIO) == Fnaf3Lesson.Sys.REBOOT
                && lesson.sys(Fnaf3Lesson.System3.CAMERA) == Fnaf3Lesson.Sys.OK);
        check("no sight budget before the host says", lesson.sightS() == -1 && lesson.luresLeft() == -1);
        apply(lesson, 0, "sight", "24");
        apply(lesson, 0, "lures", "2");
        check("the sight budget and the lures left", lesson.sightS() == 24 && lesson.luresLeft() == 2);
        check("a sight budget is a number", refuses(lesson, "sight", "-1"));
        check("lures are a number", refuses(lesson, "lures", "many"));
        check("a bad system is refused", refuses(lesson, "sys", "POWER", "OK"));
        check("a bad state is refused", refuses(lesson, "sys", "VENT", "BROKEN"));
        check("an unknown verb is refused", refuses(lesson, "say", "anything"));
        check("a bad origin is refused", refuses(lesson, "origin", "-5"));

        // The difficulty table (g649-g654) and the clock (g642/g644).
        check("AI by night", Fnaf3Lesson.ai(1) == 0 && Fnaf3Lesson.ai(2) == 2 && Fnaf3Lesson.ai(5) == 5
                && Fnaf3Lesson.ai(6) == 7);
        check("Night 1's hour is 40 s", Fnaf3Lesson.hour(39_999, 1).equals("12 AM")
                && Fnaf3Lesson.hour(40_000, 1).equals("1 AM") && Fnaf3Lesson.hour(240_000, 1).equals("6 AM"));
        check("later hours are 60 s", Fnaf3Lesson.hour(59_999, 6).equals("12 AM")
                && Fnaf3Lesson.hour(300_000, 6).equals("5 AM") && Fnaf3Lesson.hour(999_000, 6).equals("6 AM"));
        // His mean move gap, against the host computation over the same rule.
        check("Nightmare moves every ~6.5 s", Math.abs(Fnaf3Lesson.meanMoveS(7, false) - 6.5) < 0.05);
        check("Aggressive Nightmare every ~4.1 s", Math.abs(Fnaf3Lesson.meanMoveS(7, true) - 4.1) < 0.05);
        check("Night 2 every ~11.5 s", Math.abs(Fnaf3Lesson.meanMoveS(2, false) - 11.5) < 0.05);
        check("more AI, faster", Fnaf3Lesson.meanMoveS(5, false) < Fnaf3Lesson.meanMoveS(4, false));

        // The vent topology (fnaf3.js VENTS).
        check("cam 10 leads into vent 14", Fnaf3Lesson.ventFrom(10) == 14);
        check("cam 2 leads into vent 15", Fnaf3Lesson.ventFrom(2) == 15);
        check("cam 8 leads into no vent", Fnaf3Lesson.ventFrom(8) == 0);
        check("14 and 15 are lethal", Fnaf3Lesson.lethal(14) && Fnaf3Lesson.lethal(15) && !Fnaf3Lesson.lethal(11));

        // The panel's clearance: inside the display, above the feed region (y 130)
        // and left of the HUD region (x 2140) by the guard.
        check("panel inside the display", Fnaf3Lesson.LEFT >= 0 && Fnaf3Lesson.RIGHT <= 2400
                && Fnaf3Lesson.TOP >= 0 && Fnaf3Lesson.BOTTOM <= 1080);
        check("panel clears the feed", Fnaf3Lesson.BOTTOM + Fnaf3Lesson.GUARD_PX <= 130);
        check("panel clears the HUD", Fnaf3Lesson.RIGHT + Fnaf3Lesson.GUARD_PX <= 2140);

        if (failures > 0) {
            System.out.println("Fnaf3LessonTest: " + failures + " failure(s)");
            System.exit(1);
        }
        System.out.println("Fnaf3LessonTest: all checks passed");
    }
}
