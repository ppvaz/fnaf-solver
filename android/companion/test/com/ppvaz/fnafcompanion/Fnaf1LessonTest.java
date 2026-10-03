package com.ppvaz.fnafcompanion;

import static com.ppvaz.fnafcompanion.Check.check;

/** Host-only contract for the FNaF 1 teach lesson: vocabulary, clocks, refusals. */
public final class Fnaf1LessonTest {
    private static boolean refuses(Fnaf1Lesson lesson, String... field) {
        try {
            lesson.apply(field, 0);
            return false;
        } catch (IllegalArgumentException expected) {
            return true;
        }
    }

    public static void main(String[] args) {
        Fnaf1Lesson lesson = new Fnaf1Lesson();
        check("no origin, no night time", lesson.nightMs(123) == -1);
        lesson.apply(new String[] {"origin", "1000000000"}, 0);
        check("night ms from the origin", lesson.nightMs(1_000_000_000L + 5_000_000_000L) == 5000);
        lesson.apply(new String[] {"step", "CHECK_LEFT"}, 0);
        check("a named step", lesson.step() == Fnaf1Lesson.Step.CHECK_LEFT);
        lesson.apply(new String[] {"seen", "L", "OCCUPIED"}, 0);
        lesson.apply(new String[] {"door", "R", "SHUT"}, 0);
        check("seen and door per side", lesson.seen(true) == Fnaf1Lesson.Seen.OCCUPIED
                && lesson.door(false) == Fnaf1Lesson.Door.SHUT && lesson.door(true) == Fnaf1Lesson.Door.UNKNOWN);
        check("host text is never a step", refuses(lesson, "step", "Hello"));
        check("a bad side is refused", refuses(lesson, "seen", "X", "CLEAR"));
        check("a bad origin is refused", refuses(lesson, "origin", "-5"));
        check("an unknown verb is refused", refuses(lesson, "say", "anything"));
        // The roll clocks: first fire one period after the night's first frame.
        check("Bonnie's first tick at 4970", Fnaf1Lesson.untilNext(0, Fnaf1Lesson.BONNIE_MS) == 4970
                && Fnaf1Lesson.untilNext(4969, Fnaf1Lesson.BONNIE_MS) == 1
                && Fnaf1Lesson.untilNext(4970, Fnaf1Lesson.BONNIE_MS) == 4970);
        check("phase is a fraction", Fnaf1Lesson.phase(2485, Fnaf1Lesson.BONNIE_MS) == 0.5);
        check("the hour follows 90 s then 89 s", "12 AM".equals(Fnaf1Lesson.hour(89_999))
                && "1 AM".equals(Fnaf1Lesson.hour(90_000)) && "2 AM".equals(Fnaf1Lesson.hour(179_000))
                && "6 AM".equals(Fnaf1Lesson.hour(535_000)));
        for (Fnaf1Lesson.Step step : Fnaf1Lesson.Step.values()) {
            check(step + " fits a line", step.title.length() <= 48 && step.why.length() <= 60);
        }
        Check.done("Fnaf1LessonTest: all checks passed");
    }
}
