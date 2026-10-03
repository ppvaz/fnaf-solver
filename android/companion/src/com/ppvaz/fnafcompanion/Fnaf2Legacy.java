package com.ppvaz.fnafcompanion;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Locale;
import java.util.function.Supplier;

/**
 * LEGACY (FNaF 2 retail 2.0.7 on the moto g56): every on-device reader the
 * FNaF 2 night lane still consumes, in one place, so the rest of the Companion
 * is game-agnostic.
 *
 * <p>CLAUDE.md (2026-09-24/25): a detector reads small native regions and the
 * rule that decides lives on the host; the 20x9 grid, grid-fitted rules and
 * luma reducers are discontinued, and their existing users -- FNaF 2's
 * pipeline -- are to be converted after recalibration, not extended. This
 * class is that existing user, quarantined. It serves exactly what a live
 * FNaF 2 consumer reads and nothing else:</p>
 * <ul>
 * <li>{@code GET}/{@code FRAME}: freshness, the grid-fitted
 *     {@link ScreenIdentity} label, the stroke-derived {@code monitorUp}, the
 *     two control stroke scores, the latched night onset and the phone's wall
 *     clock ({@code packages/play/src/campaign/modern-campaign-ports.ts},
 *     {@code night-anchor.js}, {@code intersection-state-gate.mjs}); FRAME
 *     adds the 180 grid cells the grid-fitted monitor and mask rules read;</li>
 * <li>{@code WATCH}/{@code READ}: the twelve camera-button pixels behind the
 *     arm check;</li>
 * <li>{@code TRACE}: the frozen {@code fnaf2-frame-trace-v3} file that
 *     {@code night-run.sh} pulls and {@code actuation-frame-metric.ts},
 *     {@code tap-stall-audit.mjs} and {@code phase-reconstruct.mjs} read.</li>
 * </ul>
 * <p>The capture service runs it only while the target is FNaF 2; any other
 * target gets {@code ERROR legacy-inactive} from these verbs and never a FNaF 2
 * label. Converting it means: register the same pixels as REGIONs (the camera
 * pixels and the stroke strips are exact functions of native pixels a REGION
 * read returns unchanged), port the rules to the host, compare the two traces
 * on a real FNaF 2 night, switch, and delete this class.</p>
 *
 * <p>Pure Java: {@code android/companion/test.sh} drives it with synthetic
 * frames ({@code Fnaf2LegacyTest}).</p>
 */
public final class Fnaf2Legacy {
    public static final int GRID_WIDTH = PixelWatch.GRID_WIDTH;
    public static final int GRID_HEIGHT = PixelWatch.GRID_HEIGHT;
    public static final int CELLS = GRID_WIDTH * GRID_HEIGHT;
    /** A frame older than this at read time is stale. */
    public static final long MAX_FRAME_AGE_US = 250_000L;
    /**
     * A complete ten-minute night at 60 Hz. At native 2400x1080 the retained
     * grid plus the control values is about 27 MB, far cheaper than image
     * buffers. The trace is written only after stop: on the control thread for
     * {@code TRACE stop}, on its own thread when a capture stop saves it.
     */
    public static final int TRACE_MAX_FRAMES = 36_000;
    public static final String TRACE_SCHEMA = "fnaf2-frame-trace-v3";

    private static final int UNKNOWN = PixelWatch.UNKNOWN;

    private final int maxImages;
    private final Object lock = new Object();
    private final PixelWatch.Spec watchSpec = PixelWatch.defaultSpec();
    private final NightOnsetLatch latch = new NightOnsetLatch();
    // Preallocated and filled in place: the 60 fps callback must not allocate.
    private final int[] grid = new int[CELLS];
    private final int[] traceGrid = new int[CELLS];
    private final int[] watchValues = new int[PixelWatch.MAX_ENTRIES];
    private boolean gridValid;
    private long sequence;
    private long imageNs;
    private int identity = ScreenIdentity.UNKNOWN;
    private int maskStroke = UNKNOWN;
    private int monitorStroke = UNKNOWN;
    private volatile boolean watchActive;

    private final Object traceLock = new Object();
    private volatile boolean traceActive;
    private FrameTrace trace;
    private volatile String lastTrace = "trace=OFF";

    public Fnaf2Legacy(int maxImages) {
        this.maxImages = maxImages;
        Arrays.fill(watchValues, UNKNOWN);
    }

    /** A new capture generation: the onset re-latches and the watch unloads. */
    public void reset() {
        latch.reset();
        synchronized (lock) {
            gridValid = false;
            sequence = 0L;
            imageNs = 0L;
            identity = ScreenIdentity.UNKNOWN;
            maskStroke = UNKNOWN;
            monitorStroke = UNKNOWN;
            watchActive = false;
            Arrays.fill(watchValues, UNKNOWN);
        }
    }

    public PixelWatch.Spec watchSpec() {
        return watchSpec;
    }

    /** The latched night onset's image time, or {@link NightOnsetLatch#NOT_LATCHED}. */
    public long onsetNs() {
        return latch.onsetNs();
    }

    /** The newest frame's identity, for the periodic status and the teach panel. */
    public int identity() {
        synchronized (lock) {
            return identity;
        }
    }

    public long sequence() {
        synchronized (lock) {
            return sequence;
        }
    }

    public long imageNs() {
        synchronized (lock) {
            return imageNs;
        }
    }

    public PixelWatch.ControlState controlState() {
        synchronized (lock) {
            return PixelWatch.controlState(maskStroke, monitorStroke);
        }
    }

    public boolean traceActive() {
        return traceActive;
    }

    /**
     * Capture thread, full detector pass over one frame. {@code teachShown}
     * withholds the one reader that cannot avoid the FNaF 2 teach panel (the
     * native lifecycle labels): identity falls back to the grid alone.
     * {@code companionForeground} is the system's own fact that the
     * Companion's activity is on screen: the frame is the helper, whatever its
     * colours would make a grid rule say.
     */
    public void onFrame(NativeFrame frame, long frameImageNs, long callbackNs,
            long elapsedNs, boolean teachShown, boolean companionForeground) {
        boolean nativeSize = frame.width() == NativeFrame.WIDTH
                && frame.height() == NativeFrame.HEIGHT;
        synchronized (lock) {
            sequence++;
            imageNs = frameImageNs;
            boolean complete = sampleGrid(frame, grid);
            gridValid = complete;
            identity = companionForeground ? ScreenIdentity.COMPANION
                    : !complete ? ScreenIdentity.UNKNOWN
                    : teachShown ? ScreenIdentity.classify(grid)
                    : ScreenIdentity.classify(frame, grid);
            if (nativeSize) {
                maskStroke = PixelWatch.controlDownStrokeScore(frame, true);
                monitorStroke = PixelWatch.controlDownStrokeScore(frame, false);
            } else {
                maskStroke = UNKNOWN;
                monitorStroke = UNKNOWN;
            }
            if (watchActive && nativeSize) {
                PixelWatch.readInto(watchSpec, frame, watchValues);
            } else {
                Arrays.fill(watchValues, 0, watchSpec.size(), UNKNOWN);
            }
            latch.onFrame(frameImageNs, identity);
            if (traceActive && nativeSize) {
                recordTrace(grid, frameImageNs, elapsedNs, callbackNs, sequence,
                        maskLuma(frame, complete), monitorLuma(frame, complete),
                        maskStroke, monitorStroke, identity,
                        complete ? meanLuma(grid) : UNKNOWN);
            }
        }
    }

    /**
     * Capture thread, trace mode. The full detector pass can itself make an
     * ImageReader observer lossy, so a traced frame samples only what the
     * trace retains -- the grid, the fast stroke sampler, the camera pixels and
     * the block means -- and publishes that as the current snapshot so FRAME
     * stays atomic with the trace. {@code frame} is null when the image had no
     * plane: the row is kept, every value UNKNOWN.
     */
    public void onTraceFrame(NativeFrame frame, long frameImageNs, long callbackNs,
            long elapsedNs) {
        synchronized (lock) {
            long seq = ++sequence;
            if (frame == null) {
                Arrays.fill(traceGrid, UNKNOWN);
                recordTrace(traceGrid, frameImageNs, elapsedNs, callbackNs, seq,
                        UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN, ScreenIdentity.UNKNOWN, UNKNOWN);
                return;
            }
            boolean complete = sampleGrid(frame, traceGrid);
            int maskLuma = maskLuma(frame, complete);
            int monitorLuma = monitorLuma(frame, complete);
            int mask = complete ? PixelWatch.controlDownStrokeScoreFast(frame, true) : UNKNOWN;
            int monitor = complete ? PixelWatch.controlDownStrokeScoreFast(frame, false) : UNKNOWN;
            int frameIdentity = complete ? ScreenIdentity.classify(traceGrid) : ScreenIdentity.UNKNOWN;
            int gridMean = complete ? meanLuma(traceGrid) : UNKNOWN;
            // The live arm check still needs the camera pixels during a trace.
            PixelWatch.readInto(watchSpec, frame, watchValues);
            imageNs = frameImageNs;
            gridValid = complete;
            System.arraycopy(traceGrid, 0, grid, 0, CELLS);
            identity = frameIdentity;
            maskStroke = mask;
            monitorStroke = monitor;
            // Traced frames never reach the full pass, so the onset latch is
            // fed here too: night5-anchor4 started its trace before the onset
            // and the latch read -1 for 36 reads.
            latch.onFrame(frameImageNs, frameIdentity);
            recordTrace(traceGrid, frameImageNs, elapsedNs, callbackNs, seq,
                    maskLuma, monitorLuma, mask, monitor, frameIdentity, gridMean);
        }
    }

    /**
     * {@code GET} (withGrid false) or {@code FRAME} (withGrid true): the
     * snapshot fields and, for FRAME, the grid from ONE locked read, so both
     * describe one frame and share one {@code seq}. GET then GRID agreed on a
     * sequence 0 times in 12 on the g56 (2026-09-05); atomicity is the fix.
     *
     * @param contentInvalidReason the capture's content-metadata refusal, or
     *        null when the captured content is valid
     */
    public String snapshotLine(boolean withGrid, long nowNs, long nowWallMs,
            String contentInvalidReason, int contentWidth, int contentHeight,
            int contentVisible) {
        long seq;
        long frameImageNs;
        int frameIdentity;
        int mask;
        int monitor;
        int[] gridCopy = null;
        synchronized (lock) {
            seq = sequence;
            frameImageNs = imageNs;
            frameIdentity = identity;
            mask = maskStroke;
            monitor = monitorStroke;
            if (withGrid && gridValid) gridCopy = grid.clone();
        }
        MonitorStateDetector.Result monitorFact =
                MonitorStateDetector.fromNativeControlStrokes(frameIdentity, mask, monitor);
        long ageUs = frameImageNs > 0 ? (nowNs - frameImageNs) / 1_000L : -1;
        String invalidReason = ageUs < 0 ? "timestamp-invalid"
                : ageUs > MAX_FRAME_AGE_US ? "frame-stale" : contentInvalidReason;
        StringBuilder out = new StringBuilder(withGrid ? 1_600 : 512);
        out.append("snapshotNs=").append(nowNs)
                .append(" wallMs=").append(nowWallMs)
                .append(" visualCaptureNs=").append(frameImageNs)
                .append(" nightOnsetImageNs=").append(latch.onsetNs());
        if (invalidReason == null) {
            out.append(" visual=OBSERVED visualReason=none seq=").append(seq)
                    .append(" ageUs=").append(ageUs)
                    .append(" content=").append(contentWidth).append('x').append(contentHeight)
                    .append(" visible=").append(contentVisible)
                    .append(" screen=").append(ScreenIdentity.label(frameIdentity))
                    .append(" monitorUp=").append(monitorValue(monitorFact))
                    .append(" monitorReason=").append(monitorFact.reason);
        } else {
            out.append(" visual=UNKNOWN visualReason=").append(invalidReason)
                    .append(" seq=").append(seq)
                    .append(" reason=").append(invalidReason)
                    .append(" ageUs=").append(ageUs)
                    .append(" content=").append(contentWidth).append('x').append(contentHeight)
                    .append(" visible=").append(contentVisible)
                    .append(" screen=UNKNOWN monitorUp=UNKNOWN monitorReason=")
                    .append(monitorFact.reason);
        }
        out.append(" mask_button_downstroke=").append(strokeValue(mask))
                .append(" monitor_button_downstroke=").append(strokeValue(monitor))
                .append(' ').append(watchStatus());
        if (gridCopy != null) {
            out.append(" grid=").append(GRID_WIDTH).append('x').append(GRID_HEIGHT)
                    .append(" cells=");
            NativeFrame.appendRgbHex(out, gridCopy);
        }
        return out.toString();
    }

    /** {@code READ}: every watch entry's value (or UNKNOWN) with its frame's stamps. */
    public String readLine(long nowNs, String contentInvalidReason) {
        if (!watchActive) {
            return "ERROR watch-not-loaded expected=" + watchSpec.sha256();
        }
        long seq;
        long frameImageNs;
        int[] values = new int[watchSpec.size()];
        synchronized (lock) {
            seq = sequence;
            frameImageNs = imageNs;
            System.arraycopy(watchValues, 0, values, 0, values.length);
        }
        long ageUs = frameImageNs > 0 ? (nowNs - frameImageNs) / 1_000L : -1;
        String invalidReason = ageUs < 0 ? "frame-pending"
                : ageUs > MAX_FRAME_AGE_US ? "frame-stale" : contentInvalidReason;
        StringBuilder result = new StringBuilder(256);
        result.append("OK read=")
                .append(invalidReason == null ? "OBSERVED" : "UNKNOWN")
                .append(" spec=").append(watchSpec.sha256())
                .append(" seq=").append(seq)
                .append(" snapshotNs=").append(frameImageNs)
                .append(" ageUs=").append(ageUs);
        if (invalidReason != null) result.append(" reason=").append(invalidReason);
        for (int i = 0; i < watchSpec.size(); i++) {
            result.append(' ').append(watchSpec.entry(i).name).append('=');
            result.append(invalidReason != null || values[i] == UNKNOWN
                    ? "UNKNOWN" : Integer.toString(values[i]));
        }
        return result.toString();
    }

    public String watchStatus() {
        return "watch=" + (watchActive ? "ACTIVE" : "OFF")
                + " spec=" + watchSpec.sha256()
                + " entries=" + watchSpec.size();
    }

    /** {@code WATCH <token> status|<sha256>}. */
    public String watchCommand(String argument, boolean nativeSize) {
        if ("status".equals(argument)) return "OK " + watchStatus();
        if (!watchSpec.sha256().equals(argument)) {
            return "ERROR watch-spec-mismatch expected=" + watchSpec.sha256();
        }
        if (!nativeSize) return "ERROR watch-native-resolution-required";
        watchActive = true;
        return "OK " + watchStatus();
    }

    /** {@code TRACE <token> start <label>}: frames are drained in order until stop. */
    public String traceStart(String label, File directory, boolean nativeSize,
            long startNs, long startElapsedNs) {
        if (!nativeSize) return "ERROR trace-native-resolution-required";
        if (!validLabel(label)) return "ERROR trace-label";
        synchronized (traceLock) {
            if (traceActive || trace != null) return "ERROR trace-already-active";
            if (!directory.isDirectory() && !directory.mkdirs()) return "ERROR trace-directory";
            File file = new File(directory, label + "-" + startNs + ".tsv");
            trace = new FrameTrace(label, file, startNs, startElapsedNs, maxImages,
                    watchSpec.sha256());
            traceActive = true;
            // The trace always carries the camera pixels, independent of
            // whether a live consumer loaded the watch.
            watchActive = true;
            lastTrace = trace.status("ACTIVE");
            return "OK " + lastTrace;
        }
    }

    /** {@code TRACE <token> stop}: write the retained rows and report the file. */
    public String traceStop() {
        Supplier<String> held = traceDetach();
        return held == null ? "ERROR trace-not-active" : held.get();
    }

    /**
     * Detaches the held trace -- recording, or full and no longer recording --
     * and returns the write of its file, for the caller to run where a
     * multi-megabyte write may block; null when no trace is held. A full trace
     * stays held until this is called, so a capture stop can still save it.
     */
    public Supplier<String> traceDetach() {
        FrameTrace stopped;
        synchronized (traceLock) {
            stopped = trace;
            if (stopped == null) return null;
            traceActive = false;
            trace = null;
        }
        return () -> writeTrace(stopped);
    }

    private String writeTrace(FrameTrace stopped) {
        try {
            stopped.write();
            lastTrace = stopped.status(stopped.full ? "FULL" : "STOPPED");
            return "OK " + lastTrace;
        } catch (IOException error) {
            lastTrace = stopped.status("WRITE-ERROR");
            return "ERROR trace-write " + error.getClass().getSimpleName();
        }
    }

    public String traceStatus() {
        synchronized (traceLock) {
            if (trace == null) return lastTrace;
            return trace.status(traceActive ? "ACTIVE" : "READY");
        }
    }

    public static boolean validLabel(String label) {
        if (label == null || label.length() < 1 || label.length() > 48) return false;
        for (int index = 0; index < label.length(); index++) {
            char value = label.charAt(index);
            if (!((value >= 'a' && value <= 'z') || (value >= 'A' && value <= 'Z')
                    || (value >= '0' && value <= '9')
                    || value == '-' || value == '_' || value == '.')) {
                return false;
            }
        }
        return true;
    }

    private void recordTrace(int[] sourceGrid, long frameImageNs, long elapsedNs,
            long callbackNs, long seq, int maskLuma, int monitorLuma,
            int mask, int monitor, int frameIdentity, int gridMeanLuma) {
        synchronized (traceLock) {
            if (!traceActive || trace == null) return;
            if (!trace.record(frameImageNs, elapsedNs, callbackNs, seq, sourceGrid,
                    maskLuma, monitorLuma, mask, monitor, frameIdentity, gridMeanLuma)) {
                traceActive = false;
                lastTrace = trace.status("FULL");
            }
        }
    }

    private static boolean sampleGrid(NativeFrame frame, int[] target) {
        boolean complete = true;
        for (int gy = 0; gy < GRID_HEIGHT; gy++) {
            for (int gx = 0; gx < GRID_WIDTH; gx++) {
                int cell = frame.rgb(PixelWatch.gridSampleX(gx, frame.width()),
                        PixelWatch.gridSampleY(gy, frame.height()));
                if (cell == UNKNOWN) complete = false;
                target[gy * GRID_WIDTH + gx] = cell;
            }
        }
        return complete;
    }

    private static int maskLuma(NativeFrame frame, boolean complete) {
        return complete ? PixelWatch.blockLuma(frame,
                PixelWatch.MASK_BUTTON_X, PixelWatch.MASK_BUTTON_Y,
                PixelWatch.MASK_BUTTON_X + PixelWatch.MASK_BUTTON_WIDTH,
                PixelWatch.MASK_BUTTON_Y + PixelWatch.MASK_BUTTON_HEIGHT,
                PixelWatch.CONTROL_BUTTON_STEP) : UNKNOWN;
    }

    private static int monitorLuma(NativeFrame frame, boolean complete) {
        return complete ? PixelWatch.blockLuma(frame,
                PixelWatch.MONITOR_BUTTON_X, PixelWatch.MONITOR_BUTTON_Y,
                PixelWatch.MONITOR_BUTTON_X + PixelWatch.MONITOR_BUTTON_WIDTH,
                PixelWatch.MONITOR_BUTTON_Y + PixelWatch.MONITOR_BUTTON_HEIGHT,
                PixelWatch.CONTROL_BUTTON_STEP) : UNKNOWN;
    }

    /** The frozen trace column {@code grid_mean_luma}: integer mean luma of the cells. */
    static int meanLuma(int[] cells) {
        long total = 0;
        for (int cell : cells) {
            if (cell == UNKNOWN) return UNKNOWN;
            total += PixelWatch.luma(cell);
        }
        return (int) (total / cells.length);
    }

    private static String monitorValue(MonitorStateDetector.Result monitor) {
        switch (monitor.state) {
            case UP: return "true";
            case DOWN: return "false";
            default: return "UNKNOWN";
        }
    }

    private static String strokeValue(int value) {
        return value == UNKNOWN ? "UNKNOWN" : Integer.toString(value);
    }

    /**
     * Bounded, device-local visual trace. The Image timestamp and
     * System.nanoTime callback timestamp stay in the helper's monotonic
     * domain; the grid and control values are copied from that same image
     * before it is closed. No host polling is involved. The format is frozen:
     * its readers parse these column names.
     */
    static final class FrameTrace {
        private final String label;
        private final File file;
        private final long startNs;
        private final long startElapsedNs;
        private final int maxImages;
        private final String watchSpecSha;
        private final long[] timestampNs = new long[TRACE_MAX_FRAMES];
        private final long[] elapsedNs = new long[TRACE_MAX_FRAMES];
        private final long[] callbackNs = new long[TRACE_MAX_FRAMES];
        private final long[] intervalNs = new long[TRACE_MAX_FRAMES];
        private final long[] sequence = new long[TRACE_MAX_FRAMES];
        private final int[] grid = new int[TRACE_MAX_FRAMES * CELLS];
        private final int[] maskLuma = new int[TRACE_MAX_FRAMES];
        private final int[] monitorLuma = new int[TRACE_MAX_FRAMES];
        private final int[] maskDownstroke = new int[TRACE_MAX_FRAMES];
        private final int[] monitorDownstroke = new int[TRACE_MAX_FRAMES];
        private final int[] screenIdentity = new int[TRACE_MAX_FRAMES];
        private final int[] gridMeanLuma = new int[TRACE_MAX_FRAMES];
        private int count;
        private long lastTimestampNs;
        private long maxIntervalNs;
        private int intervalsOver25ms;
        boolean full;

        FrameTrace(String label, File file, long startNs, long startElapsedNs,
                int maxImages, String watchSpecSha) {
            this.label = label;
            this.file = file;
            this.startNs = startNs;
            this.startElapsedNs = startElapsedNs;
            this.maxImages = maxImages;
            this.watchSpecSha = watchSpecSha;
        }

        boolean record(long imageTimestampNs, long imageElapsedNs, long imageCallbackNs,
                long visualSeq, int[] sourceGrid, int sourceMaskLuma, int sourceMonitorLuma,
                int sourceMaskDownstroke, int sourceMonitorDownstroke,
                int sourceScreenIdentity, int sourceGridMeanLuma) {
            // acquireNextImage may first return a frame that was queued just
            // before START. It is not part of this measurement window and
            // must not manufacture a false long interval at the front.
            if (imageTimestampNs < startNs) return true;
            if (count >= TRACE_MAX_FRAMES) {
                full = true;
                return false;
            }
            int index = count++;
            timestampNs[index] = imageTimestampNs;
            elapsedNs[index] = imageElapsedNs;
            callbackNs[index] = imageCallbackNs;
            sequence[index] = visualSeq;
            intervalNs[index] = lastTimestampNs == 0L
                    ? 0L : Math.max(0L, imageTimestampNs - lastTimestampNs);
            if (intervalNs[index] > maxIntervalNs) maxIntervalNs = intervalNs[index];
            if (intervalNs[index] > 25_000_000L) intervalsOver25ms++;
            lastTimestampNs = imageTimestampNs;
            System.arraycopy(sourceGrid, 0, grid, index * CELLS, CELLS);
            maskLuma[index] = sourceMaskLuma;
            monitorLuma[index] = sourceMonitorLuma;
            maskDownstroke[index] = sourceMaskDownstroke;
            monitorDownstroke[index] = sourceMonitorDownstroke;
            screenIdentity[index] = sourceScreenIdentity;
            gridMeanLuma[index] = sourceGridMeanLuma;
            return true;
        }

        void write() throws IOException {
            // Up to 36,000 rows of ~1.2 KB: one syscall per row without a buffer.
            try (OutputStream output = new BufferedOutputStream(new FileOutputStream(file, false), 1 << 16)) {
                String header = "# schema=" + TRACE_SCHEMA
                        + " image_clock=helper-monotonic-ns"
                        + " elapsed_clock=android-elapsed-realtime-ns"
                        + " image_timestamp=Image.getTimestamp"
                        + " acquisition=ImageReader.acquireNextImage"
                        + " max_images=" + maxImages
                        + " capture=2400x1080"
                        + " grid=20x9"
                        + " watch_spec=" + watchSpecSha
                        + " start_ns=" + startNs
                        + " start_elapsed_ns=" + startElapsedNs
                        + " label=" + label + "\n"
                        + "seq\timage_ns\telapsed_ns\tcallback_ns\tinterval_ns"
                        + "\tgrid_mean_luma\tscreen_identity\tmask_luma"
                        + "\tmonitor_luma\tmask_downstroke\tmonitor_downstroke"
                        + "\tgrid_hex\n";
                output.write(header.getBytes(StandardCharsets.US_ASCII));
                int[] row = new int[CELLS];
                for (int index = 0; index < count; index++) {
                    StringBuilder line = new StringBuilder(1_400);
                    line.append(sequence[index]).append('\t')
                            .append(timestampNs[index]).append('\t')
                            .append(elapsedNs[index]).append('\t')
                            .append(callbackNs[index]).append('\t')
                            .append(intervalNs[index]).append('\t')
                            .append(gridMeanLuma[index]).append('\t')
                            .append(screenIdentity[index]).append('\t')
                            .append(maskLuma[index]).append('\t')
                            .append(monitorLuma[index]).append('\t')
                            .append(maskDownstroke[index]).append('\t')
                            .append(monitorDownstroke[index]).append('\t');
                    System.arraycopy(grid, index * CELLS, row, 0, CELLS);
                    NativeFrame.appendRgbHex(line, row);
                    line.append('\n');
                    output.write(line.toString().getBytes(StandardCharsets.US_ASCII));
                }
            }
        }

        String status(String state) {
            return String.format(Locale.US,
                    "trace=%s label=%s file=%s frames=%d maxFrames=%d full=%s "
                            + "maxIntervalNs=%d intervalsOver25ms=%d startNs=%d startElapsedNs=%d",
                    state, label, file.getName(), count, TRACE_MAX_FRAMES, full,
                    maxIntervalNs, intervalsOver25ms, startNs, startElapsedNs);
        }
    }
}
