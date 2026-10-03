package com.ppvaz.fnafcompanion;

import static com.ppvaz.fnafcompanion.Check.check;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The Companion's refusal vocabulary against companion-errors-v1.txt: every
 * word its sources can answer {@code ERROR <word>} with must be a row there,
 * and every row must still be sent. The host holds the same file
 * (companion-errors.test.ts), so a word added, renamed or dropped on one side
 * fails the side that drifted. The scanned forms are the three the vector
 * names; a word sent any other way would escape, so a fourth form joins both.
 */
public final class ControlErrorsTest {
    private static final String HYPHENED = "[a-z][a-z0-9]*(?:-[a-z0-9]+)+";
    private static final Pattern LITERAL = Pattern.compile("\"ERROR ([a-z][a-z0-9]*(?:-[a-z0-9]+)*)");
    private static final Pattern RETURNED = Pattern.compile("return \"(" + HYPHENED + ")\";");
    private static final Pattern THROWN = Pattern.compile("IllegalArgumentException\\(\"(" + HYPHENED + ")\"\\)");

    private ControlErrorsTest() {
    }

    public static void main(String[] args) throws IOException {
        List<String> vector = Files.readAllLines(Paths.get(System.getProperty(
                "errors.vector", "packages/play/test/testdata/companion-errors-v1.txt")), StandardCharsets.UTF_8);
        TreeSet<String> errors = new TreeSet<>();
        TreeSet<String> reasons = new TreeSet<>();
        Integer regions = null;
        Integer samples = null;
        Integer step = null;
        for (String row : vector) {
            if (row.startsWith("error: ")) errors.add(row.substring(7));
            else if (row.startsWith("capture-reason: ")) reasons.add(row.substring(16));
            else if (row.startsWith("limit: regions ")) regions = Integer.parseInt(row.substring(15));
            else if (row.startsWith("limit: samples ")) samples = Integer.parseInt(row.substring(15));
            else if (row.startsWith("limit: step ")) step = Integer.parseInt(row.substring(12));
        }
        check("the vector names error words and capture reasons", !errors.isEmpty() && !reasons.isEmpty());

        TreeSet<String> sent = new TreeSet<>();
        TreeSet<String> returned = new TreeSet<>();
        Path sources = Paths.get(System.getProperty("companion.src",
                "android/companion/src/com/ppvaz/fnafcompanion"));
        int files = 0;
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(sources, "*.java")) {
            for (Path source : stream) {
                files++;
                String text = new String(Files.readAllBytes(source), StandardCharsets.UTF_8);
                collect(LITERAL, text, sent);
                collect(RETURNED, text, returned);
                collect(THROWN, text, sent);
            }
        }
        check("the sources were read (" + files + " files)", files > 0);
        sent.addAll(returned);
        sent.removeAll(reasons);
        check("every capture reason is still returned: missing " + difference(reasons, returned),
                returned.containsAll(reasons));

        TreeSet<String> unlisted = difference(sent, errors);
        TreeSet<String> unsent = difference(errors, sent);
        check("every word the Companion sends is a vector row: add " + unlisted, unlisted.isEmpty());
        check("every vector row is still sent: drop " + unsent, unsent.isEmpty());

        check("limit: regions is NativeRegions.MAX_REGIONS",
                regions != null && regions == NativeRegions.MAX_REGIONS);
        check("limit: samples is NativeRegions.MAX_TOTAL_SAMPLES",
                samples != null && samples == NativeRegions.MAX_TOTAL_SAMPLES);
        check("limit: step is NativeRegions.MAX_STEP", step != null && step == NativeRegions.MAX_STEP);
        Check.done("ControlErrorsTest: all checks passed (" + errors.size() + " error words, "
                + reasons.size() + " capture reasons)");
    }

    private static void collect(Pattern pattern, String text, TreeSet<String> into) {
        Matcher match = pattern.matcher(text);
        while (match.find()) into.add(match.group(1));
    }

    private static TreeSet<String> difference(TreeSet<String> a, TreeSet<String> b) {
        TreeSet<String> out = new TreeSet<>(a);
        out.removeAll(b);
        return out;
    }
}
