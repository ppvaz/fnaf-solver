package com.ppvaz.fnafcompanion;

import static com.ppvaz.fnafcompanion.Check.check;

/** Host-only contract for the FNaF 4 teach lesson: vocabulary, clocks, refusals. */
public final class Fnaf4LessonTest {
    private static boolean refuses(Fnaf4Lesson lesson, String... field) {
        try {
            lesson.apply(field, 0);
            return false;
        } catch (IllegalArgumentException expected) {
            return true;
        }
    }

    private static boolean refusesAt(Fnaf4Lesson lesson, String... field) {
        try {
            lesson.apply(field, 0, 0L);
            return false;
        } catch (IllegalArgumentException expected) {
            return true;
        }
    }

    public static void main(String[] args) {
        Fnaf4Lesson lesson = new Fnaf4Lesson();
        check("no origin, no night time", lesson.nightMs(123) == -1);
        lesson.apply(new String[] {"origin", "1000000000"}, 0);
        check("night ms from the origin", lesson.nightMs(1_000_000_000L + 5_000_000_000L) == 5000);
        lesson.apply(new String[] {"step", "HOLD_LEFT"}, 0);
        check("a named step", lesson.step() == Fnaf4Lesson.Step.HOLD_LEFT);
        lesson.apply(new String[] {"door", "L", "BREATH"}, 0);
        lesson.apply(new String[] {"closet", "FOXY"}, 0);
        lesson.apply(new String[] {"bed", "CLEAR"}, 0);
        check("stations", lesson.door(true) == Fnaf4Lesson.Door.BREATH
                && lesson.door(false) == Fnaf4Lesson.Door.UNKNOWN
                && lesson.closet() == Fnaf4Lesson.Closet.FOXY && lesson.bed() == Fnaf4Lesson.Bed.CLEAR);
        check("host text is never a step", refuses(lesson, "step", "Hello"));
        check("a bad side is refused", refuses(lesson, "door", "X", "CLEAR"));
        check("a bad word is refused", refuses(lesson, "closet", "BONNIE"));
        check("a bad origin is refused", refuses(lesson, "origin", "-5"));
        check("an unknown verb is refused", refuses(lesson, "say", "anything"));
        lesson.apply(new String[] {"level", "42"}, 0);
        check("a level", lesson.level() == 42);
        lesson.apply(new String[] {"level", "OFF"}, 0);
        check("level off", lesson.level() == -1);
        check("a level past 100 is refused", refuses(lesson, "level", "101"));
        check("a level is a number", refuses(lesson, "level", "-3"));
        lesson.apply(new String[] {"step", "HOLD_RIGHT"}, 0, 7_000_000_000L);
        check("a step change is stamped", lesson.stepMs(7_000_000_000L + 1_500_000_000L) == 1500);
        lesson.apply(new String[] {"step", "HOLD_RIGHT"}, 0, 9_000_000_000L);
        check("the same step keeps its stamp", lesson.stepMs(9_000_000_000L) == 2000);
        check("stations", Fnaf4Lesson.station(Fnaf4Lesson.Step.HOLD_RIGHT) == Fnaf4Lesson.Station.RIGHT
                && Fnaf4Lesson.station(Fnaf4Lesson.Step.CLOSET_HOLD) == Fnaf4Lesson.Station.CLOSET
                && Fnaf4Lesson.isHold(Fnaf4Lesson.Step.CLOSET_HOLD) && !Fnaf4Lesson.isHold(Fnaf4Lesson.Step.BED));
        lesson.apply(new String[] {"fb", "mode", "NIGHTMARE"}, 0, 10_000_000_000L);
        lesson.apply(new String[] {"fb", "at", "LEFT"}, 0, 10_000_000_000L);
        lesson.apply(new String[] {"fb", "heard", "LAUGH"}, 0, 10_000_000_000L);
        lesson.apply(new String[] {"fb", "ran"}, 0, 11_000_000_000L);
        check("fredbear state", lesson.fred() == Fnaf4Lesson.Fred.NIGHTMARE
                && lesson.fredAt() == Fnaf4Lesson.FredAt.LEFT && lesson.heard() == Fnaf4Lesson.Heard.LAUGH
                && lesson.heardAgoMs(12_000_000_000L) == 2000 && lesson.stillMs(12_000_000_000L) == 1000);
        check("nightmare clocks", Fnaf4Lesson.rollMs(Fnaf4Lesson.Fred.NIGHTMARE) == 2000
                && Fnaf4Lesson.roomMs(Fnaf4Lesson.Fred.NIGHTMARE) == 20000
                && Fnaf4Lesson.rollMs(Fnaf4Lesson.Fred.FREDBEAR) == 3000);
        check("a bad fb word is refused", refusesAt(lesson, "fb", "heard", "NONE")
                && refusesAt(lesson, "fb", "mode", "SPRINGTRAP") && refusesAt(lesson, "fb", "say", "hi"));
        check("the kill windows per night", Fnaf4Lesson.Fred.FREDBEAR.hallS == 15 && Fnaf4Lesson.Fred.NIGHTMARE.hallS == 10
                && Fnaf4Lesson.Fred.NIGHTMARE_MAX.hallS == 8 && Fnaf4Lesson.Fred.NIGHTMARE_MAX.roomS == 11
                && Fnaf4Lesson.rollMs(Fnaf4Lesson.Fred.NIGHTMARE_MAX) == 2000);
        check("fredbear steps are stations", Fnaf4Lesson.station(Fnaf4Lesson.Step.FB_HOLD_RIGHT) == Fnaf4Lesson.Station.RIGHT
                && Fnaf4Lesson.isHold(Fnaf4Lesson.Step.FB_CLOSET));
        // Unheard is said as unheard: a guess is its own step, never a landing.
        lesson.apply(new String[] {"step", "FB_GUESS_LEFT"}, 0);
        check("a guess is not a landing", lesson.step() == Fnaf4Lesson.Step.FB_GUESS_LEFT
                && !lesson.step().title.contains("landed") && lesson.step().title.contains("guess"));
        check("a guess holds at its door", Fnaf4Lesson.station(Fnaf4Lesson.Step.FB_GUESS_RIGHT) == Fnaf4Lesson.Station.RIGHT
                && Fnaf4Lesson.isHold(Fnaf4Lesson.Step.FB_GUESS_LEFT));
        lesson.apply(new String[] {"step", "FB_LISTEN"}, 0);
        check("listening for the first move walks nowhere", Fnaf4Lesson.station(Fnaf4Lesson.Step.FB_LISTEN) == Fnaf4Lesson.Station.WALK
                && !Fnaf4Lesson.isHold(Fnaf4Lesson.Step.FB_LISTEN));
        lesson.apply(new String[] {"fb", "at", "UNKNOWN"}, 0, 13_000_000_000L);
        check("his place can be unknown again", lesson.fredAt() == Fnaf4Lesson.FredAt.UNKNOWN);
        lesson.apply(new String[] {"cover", "40"}, 0);
        lesson.apply(new String[] {"bedlit"}, 0, 20_000_000_000L);
        check("cover and bed due", lesson.cover() == 40 && lesson.bedDueInMs(30_000_000_000L) == 25_000
                && refuses(lesson, "cover", "140"));
        lesson.apply(new String[] {"door", "R", "STEPS"}, 0);
        check("footsteps are a door word", lesson.door(false) == Fnaf4Lesson.Door.STEPS
                && Fnaf4Lesson.station(Fnaf4Lesson.Step.STEPS_LEFT) == Fnaf4Lesson.Station.LEFT
                && Fnaf4Lesson.isHold(Fnaf4Lesson.Step.STEPS_RIGHT) && Fnaf4Lesson.DISMISS_MS == 3733);
        check("the 5 s roll", Fnaf4Lesson.untilNext(0, Fnaf4Lesson.ROLL_MS) == 5000
                && Fnaf4Lesson.untilNext(4999, Fnaf4Lesson.ROLL_MS) == 1
                && Fnaf4Lesson.phase(2500, Fnaf4Lesson.ROLL_MS) == 0.5);
        check("the hour is 60 s", "12 AM".equals(Fnaf4Lesson.hour(59_999))
                && "1 AM".equals(Fnaf4Lesson.hour(60_000)) && "5 AM".equals(Fnaf4Lesson.hour(359_999))
                && "6 AM".equals(Fnaf4Lesson.hour(360_000)) && "6 AM".equals(Fnaf4Lesson.hour(400_000)));
        for (Fnaf4Lesson.Step step : Fnaf4Lesson.Step.values()) {
            check(step + " fits a line", step.title.length() <= 48 && step.why.length() <= 60);
        }
        check("the panel is inside the display", Fnaf4Lesson.LEFT >= 0 && Fnaf4Lesson.TOP >= 0
                && Fnaf4Lesson.RIGHT <= PixelWatch.NATIVE_WIDTH && Fnaf4Lesson.BOTTOM <= PixelWatch.NATIVE_HEIGHT);
        Check.done("Fnaf4LessonTest: all checks passed");
    }
}
