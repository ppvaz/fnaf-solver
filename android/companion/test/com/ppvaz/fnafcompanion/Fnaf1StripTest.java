package com.ppvaz.fnafcompanion;

import static com.ppvaz.fnafcompanion.Check.check;

/** Host-only contract for the FNaF 1 Night 1 and 2 teaching strip: geometry, vocabulary, refusals. */
public final class Fnaf1StripTest {
    private static String show(Fnaf1Strip strip, String... words) {
        String[] field = new String[words.length + 1];
        field[0] = "show";
        System.arraycopy(words, 0, field, 1, words.length);
        return strip.apply(field, 0);
    }

    public static void main(String[] args) {
        check("schema", "fnaf1-teach-overlay-v2".equals(Fnaf1Strip.SCHEMA));
        check("native geometry", Fnaf1Strip.LEFT >= 0 && Fnaf1Strip.TOP >= 0
                && Fnaf1Strip.RIGHT <= NativeFrame.WIDTH && Fnaf1Strip.BOTTOM <= NativeFrame.HEIGHT
                && Fnaf1Strip.LEFT < Fnaf1Strip.RIGHT && Fnaf1Strip.TOP < Fnaf1Strip.BOTTOM);
        check("door-light reader clearance", Fnaf1Strip.BOTTOM + Fnaf1Strip.GUARD_PX <= 60);
        check("six stages", Fnaf1Strip.STAGES.length == 6);
        for (String stage : Fnaf1Strip.STAGES) {
            String lesson = Fnaf1Strip.lesson(stage);
            check(stage + " has its own lesson", lesson != null && !lesson.isEmpty());
            check(stage + " is FNaF 1 only", !lesson.contains("FNaF 2") && !lesson.contains("fnaf2"));
        }
        check("headline names the night and stage",
                "FNaF 1  •  Night 2  •  full-loop".equals(Fnaf1Strip.headline(2, "full-loop")));

        Fnaf1Strip strip = new Fnaf1Strip();
        check("starts at night 1, hands off", strip.status(false, true).contains("night=1 stage=hands-off run=none"));
        check("a show is applied", show(strip, "2", "night2-calibration", "n2-run-1") == null);
        check("status reports it", strip.status(true, true).equals(
                "f1strip=ATTACHED schema=fnaf1-teach-overlay-v2 permission=GRANTED interactive=false"
                        + " rect=20,0,1020,50 night=2 stage=night2-calibration run=n2-run-1"));
        check("the drawn lines follow it", strip.headline().endsWith("Night 2  •  night2-calibration")
                && strip.lesson().startsWith("Night 2 begins active"));

        check("night 3 refused", "f1strip-night".equals(show(strip, "3", "full-loop", "r")));
        check("a word for a night refused", "f1strip-night".equals(show(strip, "one", "full-loop", "r")));
        check("free text for a stage refused", "f1strip-stage".equals(show(strip, "1", "press", "r")));
        check("an upper-case run refused", "f1strip-run".equals(show(strip, "1", "full-loop", "Run")));
        check("a missing run refused", "f1strip-usage".equals(show(strip, "1", "full-loop")));
        check("an extra word refused", "f1strip-usage".equals(show(strip, "1", "full-loop", "r", "x")));
        check("another verb refused", "f1strip-usage".equals(strip.apply(new String[] {"hide", "1", "full-loop", "r"}, 0)));
        check("a refusal changes nothing", strip.status(true, false).contains("night=2 stage=night2-calibration run=n2-run-1")
                && strip.status(true, false).contains("permission=DENIED"));

        Check.done("Fnaf1StripTest: the FNaF 1 Night 1-2 strip clears the door reader and refuses free text");
    }
}
