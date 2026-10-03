package com.ppvaz.fnafcompanion;

import static com.ppvaz.fnafcompanion.Check.check;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

/**
 * Phone-free regression for the teach panel's lesson.
 *
 * <p>The vector packages/play/test/testdata/teach-lesson-night7-k3.txt is what the
 * host's cycle-lesson.js sends for the k3 Night 7 bundle; the host test
 * regenerates it from the same artifact plan. Parsing it here and landing on
 * the host's id is the cross-language agreement on the canonical text.</p>
 */
public final class CycleLessonTest {
    private static final String K3_ID = "dca6427d63595573";

    private static void checkEquals(String what, Object expected, Object actual) {
        check(what + " (expected " + expected + ", got " + actual + ")",
                expected == null ? actual == null : expected.equals(actual));
    }

    private static CycleLesson parse(List<String> lines) {
        CycleLesson.Builder builder = null;
        for (String line : lines) {
            String[] field = line.trim().split(" ");
            if (!"LESSON".equals(field[0])) throw new IllegalArgumentException("not a lesson line");
            switch (field[2]) {
                case "begin":
                    builder = CycleLesson.Builder.begin(field, 3);
                    break;
                case "row":
                    builder.row(field, 3);
                    break;
                case "commit":
                    return builder.build();
                default:
                    throw new IllegalArgumentException("unexpected " + field[2]);
            }
        }
        throw new IllegalArgumentException("no commit");
    }

    private static String refusal(List<String> lines) {
        try {
            parse(lines);
            return null;
        } catch (IllegalArgumentException error) {
            return error.getMessage();
        }
    }

    private static List<String> edited(List<String> base, int index, String replacement) {
        List<String> copy = new ArrayList<>(base);
        if (replacement == null) copy.remove(index); else copy.set(index, replacement);
        return copy;
    }

    public static void main(String[] args) throws IOException {
        List<String> vector = new ArrayList<>();
        for (String line : new String(Files.readAllBytes(Paths.get(System.getProperty(
                "teach.vector", "packages/play/test/testdata/teach-lesson-night7-k3.txt"))),
                StandardCharsets.US_ASCII).split("\n")) {
            if (!line.isEmpty()) vector.add(line);
        }
        CycleLesson lesson = parse(vector);
        checkEquals("the helper hashes the host's canonical text to the same id", K3_ID, lesson.id);
        checkEquals("night", 7, lesson.night);
        checkEquals("42 steady cycles start before stopAt", 42, lesson.cycles);
        checkEquals("first cycle at the first steady row", 7000, lesson.firstCycleAtMs);
        checkEquals("view camera", 11, lesson.viewCamera);
        checkEquals("marker camera", 9, lesson.markerCamera);

        // Where the schedule is, instant by instant.
        CycleLesson.Frame f = lesson.frameAt(-1, 2433);
        checkEquals("before the origin", CycleLesson.Phase.PENDING, f.phase);
        f = lesson.frameAt(0, 2434);
        checkEquals("t=0 opening", CycleLesson.Phase.OPENING, f.phase);
        checkEquals("t=0 raises the cams", "CAMS UP", lesson.title(f.step()));
        checkEquals("t=0 next is CAM 11", "CAM 11", lesson.title(f.next()));
        checkEquals("t=0 step ends at the next row", 300, f.stepEndMs);
        f = lesson.frameAt(900, 3334);
        checkEquals("t=900 drops the split", "CAMS DOWN", lesson.title(f.step()));
        f = lesson.frameAt(6999, 9433);
        checkEquals("the opening ends masked", "MASK ON", lesson.title(f.step()));
        checkEquals("the opening's last step runs to the first cycle", 7000, f.stepEndMs);
        check("the opening's last step has no opening successor", f.next() == null);
        f = lesson.frameAt(7000, 9434);
        checkEquals("t=7000 is cycle 1", 1, f.cycle);
        checkEquals("t=7000 unmasks", "MASK OFF", lesson.title(f.step()));
        checkEquals("t=7000 is 0 into the cycle", 0, f.tMs);
        f = lesson.frameAt(7000 + 4000, 13434);
        checkEquals("+4.0 s winds", "WIND", lesson.title(f.step()));
        checkEquals("+4.0 s: 150 ms of wind step left", 150, f.msLeft());
        f = lesson.frameAt(7000 + 4200, 13634);
        checkEquals("+4.2 s drops with the light", "DROP + LIGHT", lesson.title(f.step()));
        f = lesson.frameAt(7000 + 9999, 19433);
        checkEquals("the cycle ends masked", "MASK ON", lesson.title(f.step()));
        checkEquals("its successor is the next cycle's first row", "MASK OFF", lesson.title(f.next()));
        checkEquals("its step ends at the cycle length", 10000, f.stepEndMs);
        f = lesson.frameAt(17000, 19434);
        checkEquals("t=17000 is cycle 2", 2, f.cycle);
        // The last cycle is cut by stopAt: 417000..418070 run, 421150 does not.
        f = lesson.frameAt(418500, 420934);
        checkEquals("cycle 42", 42, f.cycle);
        checkEquals("the cut cycle ends on its wind", "WIND", lesson.title(f.step()));
        check("nothing follows the cut cycle's last executed row", f.next() == null);
        checkEquals("stopAt finishes the schedule", CycleLesson.Phase.FINISHED,
                lesson.frameAt(420000, 422434).phase);
        checkEquals("observeUntil expires the lesson", CycleLesson.Phase.EXPIRED,
                lesson.frameAt(425000, 427434).phase);

        // The game's clock counts from the onset, not from the origin.
        checkEquals("12 AM", "12 AM", CycleLesson.hourLabel(lesson.frameAt(0, 2434).hour));
        checkEquals("1 AM at 70 s of night", 1, lesson.frameAt(67566, 70000).hour);
        checkEquals("6 AM caps", 6, CycleLesson.hourOf(10_000_000L));

        // The ring: surfaces and actions of one steady cycle.
        CycleLesson.Arc[] s = lesson.steady.surfaces;
        checkEquals("four surface spans per cycle", 4, s.length);
        check("office until the cams rise", s[0].startMs == 0 && s[0].endMs == 600
                && s[0].surface == CycleLesson.Surface.OFFICE);
        check("cams until the camdrop's monitor press (lead 150)", s[1].startMs == 600
                && s[1].endMs == 4300 && s[1].surface == CycleLesson.Surface.CAMS);
        check("office until the mask", s[2].startMs == 4300 && s[2].endMs == 4749
                && s[2].surface == CycleLesson.Surface.OFFICE);
        check("masked to the cycle end", s[3].startMs == 4749 && s[3].endMs == 10000
                && s[3].surface == CycleLesson.Surface.MASK);
        CycleLesson.Arc[] a = lesson.steady.actions;
        checkEquals("four action spans per cycle", 4, a.length);
        check("hall flash", a[0].startMs == 400 && a[0].endMs == 433 && a[0].ink == CycleLesson.Ink.LIGHT);
        check("camera flash", a[1].startMs == 900 && a[1].endMs == 1000 && a[1].ink == CycleLesson.Ink.CAM);
        check("wind", a[2].startMs == 1070 && a[2].endMs == 4100 && a[2].ink == CycleLesson.Ink.WIND);
        check("camdrop light", a[3].startMs == 4150 && a[3].endMs == 4700 && a[3].ink == CycleLesson.Ink.LIGHT);
        CycleLesson.Arc[] o = lesson.opening.surfaces;
        checkEquals("opening surface spans", 5, o.length);
        check("the opening ends masked until the first cycle", o[4].startMs == 2915
                && o[4].endMs == 7000 && o[4].surface == CycleLesson.Surface.MASK);

        // The fixed vocabulary.
        CycleLesson.Row[] rows = lesson.steady.rows;
        checkEquals("cams-up names the split", "feed CAM 11, marker on 09", lesson.why(rows[2]));
        checkEquals("feed flash names the frozen camera", "freezes CAM 09 for 6.7 s", lesson.why(rows[3]));
        checkEquals("wind", "keeps the Puppet in its box", lesson.why(rows[4]));
        checkEquals("hall", "resets Foxy's charge", lesson.why(rows[1]));
        checkEquals("CAM 11 room", "Prize Corner", lesson.why(lesson.opening.rows[1]));

        // Refusals: every one of these is a lesson the panel must not draw.
        String begin = vector.get(0);
        String tokenPrefix = begin.substring(0, begin.indexOf(" begin "));
        check("a wrong id is refused", String.valueOf(refusal(edited(vector, 0,
                begin.replace(K3_ID, "0000000000000000")))).startsWith("lesson-id-mismatch"));
        checkEquals("a missing row is refused", "lesson-incomplete",
                refusal(edited(vector, 5, null)));
        checkEquals("a repeated row is refused", "lesson-row-duplicate",
                refusal(edited(vector, 2, vector.get(1))));
        checkEquals("an unknown verb is refused", "lesson-row-verb",
                refusal(edited(vector, 11, tokenPrefix + " row 10 steady 7400 flashbang 33")));
        checkEquals("dropping the cycle's mask breaks periodicity", "lesson-not-periodic",
                refusal(rowsWith(vector, tokenPrefix, 16, null, 15)));
        checkEquals("cams under a worn mask are refused", "lesson-cams-under-mask",
                refusal(edited(vector, 10, tokenPrefix + " row 9 steady 7000 hall-light 200")));
        checkEquals("a steady row past the period is refused", "lesson-steady-exceeds-period",
                refusal(edited(vector, 16, tokenPrefix + " row 15 steady 16900 mask-on 200")));
        checkEquals("an opening row inside the first cycle is refused", "lesson-opening-overlaps-cycle",
                refusal(edited(vector, 9, tokenPrefix + " row 8 opening 6990 mask-on 33")));
        checkEquals("a non-numeric time is refused", "lesson-row-at",
                refusal(edited(vector, 2, tokenPrefix + " row 1 opening -300 cam-11 33")));
        checkEquals("a camera beyond 12 is refused", "lesson-row-camera",
                refusal(edited(vector, 2, tokenPrefix + " row 1 opening 300 cam-13 33")));
        checkEquals("a camdrop without lead/tail is refused", "lesson-row-camdrop",
                refusal(edited(vector, 15, tokenPrefix + " row 14 steady 11150 camdrop 200")));

        Check.done("CycleLessonTest: the k3 lesson parses to the host's id and narrates its schedule");
    }

    /** The vector with one row removed and the begin row count reduced to match. */
    private static List<String> rowsWith(List<String> vector, String tokenPrefix, int removeLine,
            String replacement, int newCount) {
        List<String> copy = edited(vector, removeLine, replacement);
        String begin = copy.get(0);
        String[] field = begin.split(" ");
        field[10] = String.valueOf(newCount);
        copy.set(0, String.join(" ", field));
        return copy;
    }
}
