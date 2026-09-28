package com.ppvaz.fnafcompanion;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;

/**
 * Host regression for the quarantined FNaF 2 readers: what GET, FRAME, READ,
 * WATCH and TRACE serve, and -- as important after 2026-09-27 -- what they no
 * longer serve (the discontinued luma, grid statistics, pan anchor, battery and
 * camera-selection fields).
 */
public final class Fnaf2LegacyTest {
    private static int failures;

    private static void check(String what, boolean condition) {
        if (!condition) {
            System.out.println("FAIL " + what);
            failures++;
        }
    }

    private static final long SECOND = 1_000_000_000L;

    /** A dark office with the lit meter corner and both bottom chevrons drawn. */
    private static PixelWatchTest.Frame officeFrame() {
        PixelWatchTest.Frame frame = new PixelWatchTest.Frame(
                NativeFrame.WIDTH, NativeFrame.HEIGHT, 0x101010);
        for (int gx = 0; gx < 2; gx++) {
            frame.set(PixelWatch.gridSampleX(gx, NativeFrame.WIDTH),
                    PixelWatch.gridSampleY(0, NativeFrame.HEIGHT), 0xffffff);
        }
        PixelWatchTest.drawControlStrokes(frame, true, 0xff90a0);
        PixelWatchTest.drawControlStrokes(frame, false, 0xffffff);
        frame.set(1776, 606, 0xc2dd00);
        return frame;
    }

    private static String field(String line, String key) {
        for (String token : line.split(" ")) {
            if (token.startsWith(key + "=")) return token.substring(key.length() + 1);
        }
        return null;
    }

    public static void main(String[] args) throws IOException {
        Fnaf2Legacy legacy = new Fnaf2Legacy(3);
        PixelWatchTest.Frame office = officeFrame();

        // Before any frame: nothing is observed, the onset is not latched.
        String empty = legacy.snapshotLine(false, 5 * SECOND, 1000L, null, 2400, 1080, 1);
        check("an empty snapshot is not observed", empty.contains("visual=UNKNOWN visualReason=timestamp-invalid"));
        check("an empty snapshot has no onset", "-1".equals(field(empty, "nightOnsetImageNs")));

        // A night held for more than 500 ms latches its first frame.
        long first = 10 * SECOND;
        for (int i = 0; i < 40; i++) {
            legacy.onFrame(office, first + i * 16_666_667L, first + i * 16_666_667L, 0L, false, false);
        }
        long last = first + 39 * 16_666_667L;
        check("the office frame is a FNaF 2 night", legacy.identity() == ScreenIdentity.FNAF2_NIGHT);
        check("the onset latches the run's first frame", legacy.onsetNs() == first);
        check("the controls read the unmasked office",
                legacy.controlState() == PixelWatch.ControlState.OFFICE_UNMASKED);

        String get = legacy.snapshotLine(false, last + 1_000_000L, 1234L, null, 2400, 1080, 1);
        check("GET is observed", get.contains("visual=OBSERVED visualReason=none"));
        check("GET carries the sequence", "40".equals(field(get, "seq")));
        check("GET carries the frame age", "1000".equals(field(get, "ageUs")));
        check("GET carries the image time", Long.toString(last).equals(field(get, "visualCaptureNs")));
        check("GET carries the wall clock", "1234".equals(field(get, "wallMs")));
        check("GET carries the onset", Long.toString(first).equals(field(get, "nightOnsetImageNs")));
        check("GET carries the screen label", "FNAF2_NIGHT".equals(field(get, "screen")));
        check("GET carries the stroke monitor fact", "false".equals(field(get, "monitorUp"))
                && "native-stroke-office".equals(field(get, "monitorReason")));
        check("GET carries both stroke scores",
                Integer.parseInt(field(get, "mask_button_downstroke")) >= 100
                        && Integer.parseInt(field(get, "monitor_button_downstroke")) >= 100);
        check("GET has no grid", !get.contains("cells="));
        for (String retired : new String[] {"rgba=", " luma=", "cam05_mean_luma=", " grey=",
                "gridLuma=", "screenScore=", "detectorLatencyMs=", "pan_anchor", "battery",
                "cameraSelected=", "cameraHighlights=", "mean_luma=", "screenNight=", "audio"}) {
            check("GET no longer serves " + retired.trim(), !get.contains(retired));
        }

        String frame = legacy.snapshotLine(true, last + 1_000_000L, 1234L, null, 2400, 1080, 1);
        check("FRAME carries the 20x9 grid", "20x9".equals(field(frame, "grid"))
                && field(frame, "cells") != null && field(frame, "cells").length() == 180 * 6);
        check("FRAME and GET share the sequence", "40".equals(field(frame, "seq")));

        String stale = legacy.snapshotLine(false, last + SECOND, 1234L, null, 2400, 1080, 1);
        check("a stale frame is UNKNOWN", stale.contains("visual=UNKNOWN visualReason=frame-stale")
                && "UNKNOWN".equals(field(stale, "screen")));
        String hidden = legacy.snapshotLine(false, last + 1_000_000L, 1234L, "content-hidden",
                2400, 1080, 0);
        check("a content refusal passes through", hidden.contains("visualReason=content-hidden"));

        // The camera watch: refused until loaded, by its own hash only.
        check("READ before WATCH refuses", legacy.readLine(last, null).startsWith("ERROR watch-not-loaded"));
        check("a foreign hash is refused", legacy.watchCommand("0".repeat(64), true)
                .startsWith("ERROR watch-spec-mismatch"));
        check("a non-native capture is refused", legacy.watchCommand(legacy.watchSpec().sha256(), false)
                .startsWith("ERROR watch-native-resolution-required"));
        check("the watch loads", legacy.watchCommand(legacy.watchSpec().sha256(), true)
                .equals("OK watch=ACTIVE spec=" + legacy.watchSpec().sha256() + " entries=12"));
        legacy.onFrame(office, last + 16_666_667L, last + 16_666_667L, 0L, false, false);
        String read = legacy.readLine(last + 20_000_000L, null);
        check("READ is observed", read.startsWith("OK read=OBSERVED"));
        check("READ carries the lit camera", "194".equals(field(read, "cam07_button"))
                && "0".equals(field(read, "cam01_button")));
        check("READ no longer carries the pan anchor", !read.contains("pan_anchor"));

        // The frozen v3 trace.
        File directory = Files.createTempDirectory("fnaf2-legacy-trace").toFile();
        check("a non-native trace is refused",
                legacy.traceStart("t1", directory, false, 0L, 0L).startsWith("ERROR trace-native"));
        check("a bad label is refused",
                legacy.traceStart("bad label", directory, true, 0L, 0L).startsWith("ERROR trace-label"));
        long traceStart = last + SECOND;
        String started = legacy.traceStart("t1", directory, true, traceStart, 77L);
        check("the trace starts", started.startsWith("OK trace=ACTIVE label=t1"));
        check("a second start is refused",
                legacy.traceStart("t2", directory, true, traceStart, 77L).startsWith("ERROR trace-already-active"));
        check("the trace drains", legacy.traceActive());
        for (int i = 0; i < 3; i++) {
            legacy.onTraceFrame(office, traceStart + i * 16_666_667L, traceStart + i * 16_666_667L, 5L);
        }
        legacy.onTraceFrame(null, traceStart + 3 * 16_666_667L, traceStart + 3 * 16_666_667L, 5L);
        String traced = legacy.snapshotLine(true, traceStart + 2 * 16_666_667L + 1_000L, 1L, null,
                2400, 1080, 1);
        check("FRAME follows the traced frames", "FNAF2_NIGHT".equals(field(traced, "screen"))
                || "UNKNOWN".equals(field(traced, "screen")));
        String stopped = legacy.traceStop();
        check("the trace stops", stopped.startsWith("OK trace=STOPPED label=t1") && stopped.contains("frames=4"));
        check("a second stop is refused", legacy.traceStop().startsWith("ERROR trace-not-active"));
        String name = field(stopped, "file");
        List<String> lines = Files.readAllLines(new File(directory, name).toPath(), StandardCharsets.US_ASCII);
        check("the trace keeps its v3 schema", lines.get(0).startsWith("# schema=fnaf2-frame-trace-v3 ")
                && lines.get(0).contains(" watch_spec=" + legacy.watchSpec().sha256()));
        check("the trace keeps its frozen columns", lines.get(1).equals(
                "seq\timage_ns\telapsed_ns\tcallback_ns\tinterval_ns\tgrid_mean_luma\tscreen_identity"
                        + "\tmask_luma\tmonitor_luma\tmask_downstroke\tmonitor_downstroke\tgrid_hex"));
        check("the trace keeps every frame", lines.size() == 2 + 4);
        String[] row = lines.get(2).split("\t");
        check("a traced row has twelve columns", row.length == 12);
        check("a traced row carries the night identity", "2".equals(row[6]));
        check("a traced row carries the grid", row[11].length() == 180 * 6);
        String[] missing = lines.get(5).split("\t");
        check("a plane-less frame is kept with UNKNOWN values",
                Integer.toString(Integer.MIN_VALUE).equals(missing[7]) && "0".equals(missing[6]));

        // The Companion's own activity on screen is the helper, never a game
        // label, whatever the frame's colours.
        legacy.onFrame(office, traceStart + SECOND, traceStart + SECOND, 0L, false, true);
        check("the Companion in front reads CUE_HELPER",
                legacy.identity() == ScreenIdentity.CUE_HELPER);

        legacy.reset();
        check("reset clears the onset", legacy.onsetNs() == NightOnsetLatch.NOT_LATCHED);
        check("reset unloads the watch", legacy.readLine(0L, null).startsWith("ERROR watch-not-loaded"));
        check("reset clears the identity", legacy.identity() == ScreenIdentity.UNKNOWN);

        if (failures > 0) {
            System.out.println("Fnaf2LegacyTest: " + failures + " failure(s)");
            System.exit(1);
        }
        System.out.println("Fnaf2LegacyTest: GET/FRAME/READ/WATCH/TRACE serve the live FNaF 2 fields and no retired one");
    }
}
