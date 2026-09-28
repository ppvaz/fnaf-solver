package com.ppvaz.fnafcompanion;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The writer half of the companion-status-v1 contract: for fixed inputs,
 * {@link CompanionStatus} must emit exactly the vector lines the host parser
 * decodes (tools/device/testdata/companion-status-v1.txt).
 */
public final class CompanionStatusTest {
    private static int failures;

    private static void check(String what, boolean condition) {
        if (!condition) {
            System.out.println("FAIL " + what);
            failures++;
        }
    }

    private static CompanionStatus base(String session, String capture, String reason) {
        return new CompanionStatus().put("app", "0.2.0").put("code", "16")
                .put("session", session).put("capture", capture).put("captureReason", reason);
    }

    public static void main(String[] args) throws IOException {
        List<String> vector = Files.readAllLines(Paths.get(System.getProperty(
                "status.vector", "tools/device/testdata/companion-status-v1.txt")),
                StandardCharsets.UTF_8);
        Map<String, String> lines = new HashMap<>();
        String currentCase = null;
        String endpoint = null;
        for (String raw : vector) {
            if (raw.startsWith("case: ")) currentCase = raw.substring(6).trim();
            if (raw.startsWith("line: ")) lines.put(currentCase, raw.substring(6));
            if (raw.startsWith("endpoint: ")) endpoint = raw.substring(10).replace("\\n", "\n");
        }
        check("the vector file has four cases", lines.size() == 4);

        Map<String, CompanionStatus> built = new HashMap<>();
        built.put("idle", base("0", "OFF", "not-started")
                .put("content", "UNKNOWN").put("visible", "UNKNOWN").put("frames", 0)
                .put("frameAgeMs", "UNKNOWN").put("fps", "UNKNOWN")
                .put("target", "NONE").put("game", "NONE").put("targetBuild", "NONE")
                .put("legacy", "OFF").put("regions", 0).put("regionSamples", 0).put("regionFrames", 0)
                .put("lesson", "NONE").put("lessonState", "OFF").put("panel", "NONE")
                .put("clearance", "UNCHECKED").put("overlayPermission", "DENIED").put("lease", "NONE")
                .put("battery", "UNKNOWN").put("charging", "UNKNOWN").put("thermal", CompanionStatus.thermalWord(-1))
                .put("foreground", "OTHER").put("snapshotNs", 1000L).put("wallMs", 1_790_000_000_000L));
        built.put("fnaf4-teach", base("3", "ON", "none")
                .put("content", "2400x1080").put("visible", "1").put("frames", 18234L)
                .put("frameAgeMs", "12").put("fps", String.format(java.util.Locale.US, "%.1f", 59.83))
                .put("target", "com.scottgames.fnaf4").put("game", "fnaf4").put("targetBuild", "11:2.0.4")
                .put("legacy", "OFF").put("regions", 9).put("regionSamples", 3120).put("regionFrames", 18230L)
                .put("lesson", "f4").put("lessonState", "ATTACHED").put("panel", "440,8,1960,188")
                .put("clearance", "OK:37px").put("overlayPermission", "GRANTED").put("lease", "fnaf4-run:n5a")
                .put("battery", "64").put("charging", "1").put("thermal", CompanionStatus.thermalWord(0))
                .put("foreground", "OTHER").put("snapshotNs", 123_456_789_012L).put("wallMs", 1_790_000_000_123L));
        built.put("fnaf2-legacy", base("7", "ON", "none")
                .put("content", "2400x1080").put("visible", "0").put("frames", 42)
                .put("frameAgeMs", "250").put("fps", String.format(java.util.Locale.US, "%.1f", 0.0))
                .put("target", "com.scottgames.fnaf2").put("game", "fnaf2").put("targetBuild", "26:2.0.7")
                .put("legacy", "fnaf2").put("regions", 0).put("regionSamples", 0).put("regionFrames", 0)
                .put("lesson", "f2").put("lessonState", "RUNNING:k3-night7".replace(':', '/'))
                .put("panel", "10,310,590,410").put("clearance", "VIOLATION:left_door")
                .put("overlayPermission", "GRANTED").put("lease", "NONE")
                .put("battery", "100").put("charging", "0").put("thermal", CompanionStatus.thermalWord(2))
                .put("foreground", "COMPANION").put("snapshotNs", 5L).put("wallMs", 6L));
        // A value the line cannot carry faithfully is not carried at all.
        built.put("hostile-values", new CompanionStatus().put("app", "0.2.0 beta").put("code", "16")
                .put("session", "1").put("capture", "ON").put("captureReason", "bad=value")
                .put("content", "").put("visible", null).put("frames", 1)
                .put("frameAgeMs", "UNKNOWN").put("fps", "UNKNOWN")
                .put("target", "NONE").put("game", "NONE").put("targetBuild", "NOT_INSTALLED")
                .put("legacy", "OFF").put("regions", 0).put("regionSamples", 0).put("regionFrames", 0)
                .put("lesson", "NONE").put("lessonState", "OFF").put("panel", "NONE")
                .put("clearance", "UNCHECKED").put("overlayPermission", "DENIED").put("lease", "NONE")
                .put("battery", "UNKNOWN").put("charging", "UNKNOWN").put("thermal", CompanionStatus.thermalWord(99))
                .put("foreground", "OTHER").put("snapshotNs", 9L).put("wallMs", 10L));
        for (Map.Entry<String, CompanionStatus> entry : built.entrySet()) {
            String expected = lines.get(entry.getKey());
            String actual = entry.getValue().line();
            check("case " + entry.getKey() + " writes the vector line\n  expected " + expected
                    + "\n  actual   " + actual, actual.equals(expected));
            Map<String, String> parsed = CompanionStatus.parse("OK " + actual);
            check("case " + entry.getKey() + " parses back field for field",
                    String.join(",", parsed.keySet()).equals(String.join(",", CompanionStatus.FIELDS)));
        }

        String[] fields = lines.get("idle").split(" ");
        for (int i = 0; i < CompanionStatus.FIELDS.length; i++) {
            check("field " + i + " is " + CompanionStatus.FIELDS[i],
                    fields[i].startsWith(CompanionStatus.FIELDS[i] + "="));
        }
        check("the first field is the schema", lines.get("idle").startsWith("schema=companion-status-v1 "));
        check("an unknown field is refused", refuses(() -> new CompanionStatus().put("audio", "ESP32")));
        check("the schema cannot be overwritten", refuses(() -> new CompanionStatus().put("schema", "x")));
        check("another schema is refused by the parser",
                refuses(() -> CompanionStatus.parse("OK schema=cue-helper-control-v1 capture=ON")));
        check("tokens keep plain values", CompanionStatus.token("11:2.0.4").equals("11:2.0.4"));
        check("tokens refuse spaces, equals and control characters",
                CompanionStatus.token("a b").equals("UNKNOWN") && CompanionStatus.token("a=b").equals("UNKNOWN")
                        && CompanionStatus.token("a\tb").equals("UNKNOWN") && CompanionStatus.token("").equals("UNKNOWN")
                        && CompanionStatus.token("x".repeat(97)).equals("UNKNOWN"));
        check("thermal words follow PowerManager's constants",
                CompanionStatus.thermalWord(0).equals("NONE") && CompanionStatus.thermalWord(4).equals("CRITICAL")
                        && CompanionStatus.thermalWord(6).equals("SHUTDOWN") && CompanionStatus.thermalWord(7).equals("UNKNOWN"));

        check("the endpoint vector exists", endpoint != null);
        String written = CompanionStatus.endpointProperties("0.2.0", 16, 3, 7007, 49707,
                "com.fnaf2.cuehelper.control.3", "0123456789abcdef0123456789abcdef");
        check("the endpoint file matches its vector\n  expected " + endpoint + "\n  actual   " + written,
                written.equals(endpoint));
        check("the endpoint log line carries the same endpoint",
                CompanionStatus.endpointLogLine("0.2.0", 16, 3, 7007, 49707,
                        "com.fnaf2.cuehelper.control.3", "0123456789abcdef0123456789abcdef")
                        .equals("COMPANION schema=companion-endpoint-v1 app=0.2.0 code=16 session=3 pid=7007"
                                + " port=49707 socket=com.fnaf2.cuehelper.control.3"
                                + " token=0123456789abcdef0123456789abcdef"));

        if (failures > 0) {
            System.out.println("CompanionStatusTest: " + failures + " failure(s)");
            System.exit(1);
        }
        System.out.println("CompanionStatusTest: the writer emits every companion-status-v1 vector and the endpoint handshake");
    }

    private static boolean refuses(Runnable body) {
        try {
            body.run();
            return false;
        } catch (IllegalArgumentException expected) {
            return true;
        }
    }
}
