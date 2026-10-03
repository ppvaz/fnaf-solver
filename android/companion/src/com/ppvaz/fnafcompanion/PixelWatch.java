package com.ppvaz.fnafcompanion;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;

/**
 * LEGACY (FNaF 2 retail 2.0.7 on the moto g56): the fixed native pixels the
 * FNaF 2 night lane still reads on the phone.
 *
 * <p>What is left here is what a live consumer reads, and nothing else:</p>
 * <ul>
 * <li>the twelve monitor-map camera-button pixels, served by {@code WATCH} /
 *     {@code READ} to the camera rule behind the arm check
 *     ({@code packages/play/profiles/fnaf2/moto-g56/camera-rule-moto-g56-v207.json});</li>
 * <li>the two bottom-control chevron strokes, published on every FNaF 2
 *     {@code FRAME} and read by {@code packages/adapters/src/button-strokes.js};</li>
 * <li>the 20x9 lattice the FNaF 2 screen identity and the grid-fitted monitor
 *     and mask rules still read, and the two control block means the frozen
 *     {@code fnaf2-frame-trace-v3} columns carry.</li>
 * </ul>
 *
 * <p>The luma, redness, grey-cell, battery-bar, CAM 05, Balloon Boy and Foxy
 * hall entries left on 2026-09-27: they had no live reader, and CLAUDE.md
 * discontinues luma reducers and the grid as a starting point. Each of the
 * readers above is to be converted to a REGION rule on the host after
 * recalibration (camera pixels and strokes are exact functions of native
 * pixels a REGION read returns unchanged); until then they stay here, run only
 * while the target is FNaF 2 ({@link Fnaf2Legacy}).</p>
 */
public final class PixelWatch {
    public static final int UNKNOWN = NativeFrame.UNKNOWN;
    public static final int NATIVE_WIDTH = NativeFrame.WIDTH;
    public static final int NATIVE_HEIGHT = NativeFrame.HEIGHT;
    public static final int GRID_WIDTH = 20;
    public static final int GRID_HEIGHT = 9;
    public static final int MAX_ENTRIES = 32;
    private static final int[] CAMERA_BUTTON_X = new int[] {
            1412, 1720, 1411, 1728, 1424, 1696,
            1776, 1412, 2144, 1984, 2228, 2188
    };
    private static final int[] CAMERA_BUTTON_Y = new int[] {
            784, 784, 690, 690, 916, 916,
            606, 590, 548, 716, 652, 784
    };
    /** Native bounds of the persistent lower-left mask control. */
    public static final int MASK_BUTTON_X = 260;
    public static final int MASK_BUTTON_Y = 1004;
    public static final int MASK_BUTTON_WIDTH = 720;
    public static final int MASK_BUTTON_HEIGHT = 36;
    /** Native bounds of the lower-right open-monitor control. */
    public static final int MONITOR_BUTTON_X = 1420;
    public static final int MONITOR_BUTTON_Y = 1004;
    public static final int MONITOR_BUTTON_WIDTH = 720;
    public static final int MONITOR_BUTTON_HEIGHT = 36;
    /** Both lower controls share the same native top edge. */
    public static final int CONTROL_BUTTON_Y = MASK_BUTTON_Y;
    /** Sampling step of the trace's frozen control block means. */
    public static final int CONTROL_BUTTON_STEP = 16;
    /** Fixed native chevron geometry inside the lower-left mask control. */
    public static final int MASK_STROKE_X_START = 90;
    public static final int MASK_STROKE_X_CENTER = 370;
    public static final int MASK_STROKE_X_END = 650;
    /** Fixed native chevron geometry inside the lower-right monitor control. */
    public static final int MONITOR_STROKE_X_START = 80;
    public static final int MONITOR_STROKE_X_CENTER = 360;
    public static final int MONITOR_STROKE_X_END = 650;
    /** Both controls carry two parallel downward strokes. */
    public static final int CONTROL_STROKE_Y_BASE = 2;
    public static final int CONTROL_STROKE_Y_PEAK = 16;
    public static final int CONTROL_STROKE_LINE_OFFSET = 16;
    public static final int CONTROL_STROKE_SAMPLE_STEP = 8;
    /** Trace-only sparse stroke sampling; the returned score is normalized. */
    public static final int CONTROL_STROKE_TRACE_SAMPLE_STEP = 32;
    public static final int CONTROL_STROKE_RADIUS = 3;
    /** Minimum local max-channel contrast for one stroke column. */
    public static final int CONTROL_STROKE_CONTRAST = 35;
    /** Settled-state bands measured by the native-stroke gate. */
    public static final int CONTROL_STROKE_VISIBLE_MIN = 100;
    public static final int CONTROL_STROKE_ABSENT_MAX = 40;

    /**
     * The native x the capture service samples for grid column {@code gx}: the
     * cell centre, (2gx+1) * width / 40. Shared so the teach panel's clearance
     * test reads the same points the service does.
     */
    public static int gridSampleX(int gx, int width) {
        return Math.min(width - 1, (int) (((long) gx * 2 + 1) * width / (GRID_WIDTH * 2L)));
    }

    /** The native y sampled for grid row {@code gy}; see {@link #gridSampleX}. */
    public static int gridSampleY(int gy, int height) {
        return Math.min(height - 1, (int) (((long) gy * 2 + 1) * height / (GRID_HEIGHT * 2L)));
    }

    /**
     * Mean luma over a half-open native rectangle with a sampling step, or -1.
     * Kept only for the frozen {@code fnaf2-frame-trace-v3} columns
     * ({@code mask_luma}, {@code monitor_luma}), which
     * {@code packages/review/bin/grade/actuation-frame-metric.ts} still requires.
     */
    public static int blockLuma(NativeFrame frame, int x0, int y0, int x1, int y1, int step) {
        if (step < 1) return -1;
        long total = 0;
        int count = 0;
        for (int y = y0; y < y1; y += step) {
            for (int x = x0; x < x1; x += step) {
                int rgb = frame.rgb(x, y);
                if (rgb == UNKNOWN) {
                    return -1;
                }
                total += luma(rgb);
                count++;
            }
        }
        return count == 0 ? -1 : (int) (total / count);
    }

    /** Integer Rec. 601 luma of one packed pixel, as every legacy column uses it. */
    public static int luma(int rgb) {
        int r = (rgb >> 16) & 0xff;
        int g = (rgb >> 8) & 0xff;
        int b = rgb & 0xff;
        return (77 * r + 150 * g + 29 * b) >> 8;
    }

    /** Settled UI surface states inferred from the paired bottom controls. */
    public enum ControlState {
        UNKNOWN,
        MONITOR_UP,
        MASK_ON,
        OFFICE_UNMASKED
    }

    /** One fixed native pixel, reduced to its yellowness min(r, g) - b. */
    public static final class Entry {
        public final String name;
        public final int x;
        public final int y;

        public Entry(String name, int x, int y) {
            if (name == null || name.length() == 0 || name.length() > 31
                    || !name.matches("[A-Za-z0-9_-]+")) {
                throw new IllegalArgumentException("invalid watch entry name");
            }
            if (x < 0 || y < 0) {
                throw new IllegalArgumentException("invalid watch entry bounds");
            }
            this.name = name;
            this.x = x;
            this.y = y;
        }

        /** The pixel-watch-v1 canonical row: a 1x1 YELLOWNESS pixel. */
        String canonical() {
            return String.format(Locale.US, "%s|PIXEL|%d|%d|1|1|YELLOWNESS|1|0", name, x, y);
        }
    }

    /** A versioned collection of entries, addressed by its SHA-256 hash. */
    public static final class Spec {
        private final Entry[] entries;
        private final String canonical;
        private final String sha256;

        public Spec(Entry[] entries) {
            if (entries == null || entries.length == 0 || entries.length > MAX_ENTRIES) {
                throw new IllegalArgumentException("watchlist entry count out of range");
            }
            this.entries = entries.clone();
            StringBuilder text = new StringBuilder("pixel-watch-v1\n");
            for (Entry entry : this.entries) {
                if (entry == null) throw new IllegalArgumentException("null watch entry");
                text.append(entry.canonical()).append('\n');
            }
            this.canonical = text.toString();
            this.sha256 = PixelWatch.sha256(canonical);
        }

        public int size() {
            return entries.length;
        }

        public Entry entry(int index) {
            return entries[index];
        }

        public String canonical() {
            return canonical;
        }

        public String sha256() {
            return sha256;
        }

        public int indexOfName(String name) {
            if (name == null) return -1;
            for (int index = 0; index < entries.length; index++) {
                if (entries[index].name.equals(name)) return index;
            }
            return -1;
        }
    }

    /** Return the canonical profile name for one of the twelve camera buttons. */
    public static String cameraButtonName(int cameraNumber) {
        if (cameraNumber < 1 || cameraNumber > CAMERA_BUTTON_X.length) return null;
        return String.format(Locale.US, "cam%02d_button", cameraNumber);
    }

    /** Whether an entry is the shared profile-bound point of one camera button. */
    public static boolean isCanonicalCameraButton(Entry entry, int cameraNumber) {
        if (entry == null || cameraNumber < 1
                || cameraNumber > CAMERA_BUTTON_X.length) return false;
        int index = cameraNumber - 1;
        return cameraButtonName(cameraNumber).equals(entry.name)
                && entry.x == CAMERA_BUTTON_X[index]
                && entry.y == CAMERA_BUTTON_Y[index];
    }

    private PixelWatch() {}

    /**
     * The twelve monitor-map camera buttons, measured on 2026-09-01 labelled
     * captures of the moto g56 (2400x1080): the selected button renders
     * yellow (yellowness near 194) at a fixed position on the map layout
     * drawing, which stays fixed while camera feeds pan. One pixel per button
     * centre; the camera rule reads them through {@code READ}.
     */
    public static Spec defaultSpec() {
        Entry[] entries = new Entry[CAMERA_BUTTON_X.length];
        for (int index = 0; index < entries.length; index++) {
            entries[index] = new Entry(cameraButtonName(index + 1),
                    CAMERA_BUTTON_X[index], CAMERA_BUTTON_Y[index]);
        }
        return new Spec(entries);
    }

    /** Fill {@code output} with one value per entry without allocating. */
    public static int readInto(Spec spec, NativeFrame frame, int[] output) {
        if (spec == null || frame == null || output == null
                || output.length < spec.size()) return -1;
        for (int i = 0; i < spec.size(); i++) {
            output[i] = read(spec.entry(i), frame);
        }
        return spec.size();
    }

    /** Yellowness min(r, g) - b of the entry's pixel, or {@link #UNKNOWN}. */
    public static int read(Entry entry, NativeFrame frame) {
        if (entry == null || frame == null || entry.x >= frame.width()
                || entry.y >= frame.height()) {
            return UNKNOWN;
        }
        int rgb = frame.rgb(entry.x, entry.y);
        if (rgb == UNKNOWN) return UNKNOWN;
        int r = (rgb >> 16) & 0xff;
        int g = (rgb >> 8) & 0xff;
        int b = rgb & 0xff;
        return Math.min(r, g) - b;
    }

    /**
     * Count the fixed downward-chevron columns in one native lower control.
     *
     * <p>The controls are translucent, so their filled rectangle and whole-ROI
     * mean luma move with the office background. This samples only the two
     * known chevron strokes and requires local max-channel contrast against
     * the pixels immediately above and below each stroke. It therefore accepts
     * the neutral-white monitor chevron and the pink-tinted mask chevron by
     * their fixed geometry, without treating either color or ROI brightness as
     * a state fact. The result is a coverage score, not a boolean: zero means
     * no stroke columns were observed, and UNKNOWN means the native frame was
     * unavailable or incomplete.</p>
     */
    public static int controlDownStrokeScore(NativeFrame frame, boolean maskControl) {
        return controlDownStrokeScore(frame, maskControl,
                CONTROL_STROKE_SAMPLE_STEP, false);
    }

    /**
     * Measure a control stroke with the trace-only sparse sampler.
     *
     * <p>The live gate keeps the dense calibrated score above. Trace mode only
     * needs the same settled-state separation, so it samples every 32 native
     * pixels and normalizes the result to the dense score's range. This keeps
     * the native ImageReader callback below the display-frame budget without
     * changing the live authority or its thresholds.</p>
     */
    public static int controlDownStrokeScoreFast(NativeFrame frame, boolean maskControl) {
        return controlDownStrokeScore(frame, maskControl,
                CONTROL_STROKE_TRACE_SAMPLE_STEP, true);
    }

    private static int controlDownStrokeScore(NativeFrame frame, boolean maskControl,
            int sampleStep, boolean normalize) {
        if (frame == null || frame.width() != NATIVE_WIDTH
                || frame.height() != NATIVE_HEIGHT) return UNKNOWN;
        if (sampleStep < 1) return UNKNOWN;
        int xStart = (maskControl ? MASK_BUTTON_X : MONITOR_BUTTON_X)
                + (maskControl ? MASK_STROKE_X_START : MONITOR_STROKE_X_START);
        int xCenter = (maskControl ? MASK_BUTTON_X : MONITOR_BUTTON_X)
                + (maskControl ? MASK_STROKE_X_CENTER : MONITOR_STROKE_X_CENTER);
        int xEnd = (maskControl ? MASK_BUTTON_X : MONITOR_BUTTON_X)
                + (maskControl ? MASK_STROKE_X_END : MONITOR_STROKE_X_END);
        int columns = 0;
        int hits = 0;
        for (int x = xStart; x <= xEnd; x += sampleStep) {
            int yOffset = x <= xCenter
                    ? CONTROL_STROKE_Y_BASE
                            + (CONTROL_STROKE_Y_PEAK - CONTROL_STROKE_Y_BASE)
                                    * (x - xStart) / (xCenter - xStart)
                    : CONTROL_STROKE_Y_BASE
                            + (CONTROL_STROKE_Y_PEAK - CONTROL_STROKE_Y_BASE)
                                    * (xEnd - x) / (xEnd - xCenter);
            int first = normalize
                    ? fastStrokeColumnHit(frame, x, CONTROL_BUTTON_Y + yOffset)
                    : strokeColumnHit(frame, x, CONTROL_BUTTON_Y + yOffset);
            if (first == UNKNOWN) return UNKNOWN;
            int second = normalize
                    ? fastStrokeColumnHit(frame, x,
                            CONTROL_BUTTON_Y + yOffset + CONTROL_STROKE_LINE_OFFSET)
                    : strokeColumnHit(frame, x,
                            CONTROL_BUTTON_Y + yOffset + CONTROL_STROKE_LINE_OFFSET);
            if (second == UNKNOWN) return UNKNOWN;
            if (first != 0) hits++;
            if (second != 0) hits++;
            columns += 2;
        }
        if (columns == 0) return UNKNOWN;
        if (!normalize) return hits;
        int denseColumns = ((xEnd - xStart) / CONTROL_STROKE_SAMPLE_STEP + 1) * 2;
        return (hits * denseColumns + columns / 2) / columns;
    }

    /**
     * Infer the settled game surface from the paired native control strokes.
     * A partial stroke, both absent, or an otherwise contradictory pair is
     * deliberately refused rather than treated as a surface state.
     */
    public static ControlState controlState(int maskDownstroke,
            int monitorDownstroke) {
        if (maskDownstroke < 0 || monitorDownstroke < 0) {
            return ControlState.UNKNOWN;
        }
        boolean maskVisible = maskDownstroke >= CONTROL_STROKE_VISIBLE_MIN;
        boolean maskAbsent = maskDownstroke <= CONTROL_STROKE_ABSENT_MAX;
        boolean monitorVisible = monitorDownstroke >= CONTROL_STROKE_VISIBLE_MIN;
        boolean monitorAbsent = monitorDownstroke <= CONTROL_STROKE_ABSENT_MAX;
        if (maskAbsent && monitorVisible) return ControlState.MONITOR_UP;
        if (maskVisible && monitorAbsent) return ControlState.MASK_ON;
        if (maskVisible && monitorVisible) return ControlState.OFFICE_UNMASKED;
        return ControlState.UNKNOWN;
    }

    private static int strokeColumnHit(NativeFrame frame, int x, int centerY) {
        int lineMax = 0;
        for (int y = centerY - CONTROL_STROKE_RADIUS;
                y <= centerY + CONTROL_STROKE_RADIUS; y++) {
            int rgb = frame.rgb(x, y);
            if (rgb == UNKNOWN) return UNKNOWN;
            lineMax = Math.max(lineMax, maxChannel(rgb));
        }
        long baselineTotal = 0;
        int baselineCount = 0;
        for (int y = centerY - 10; y <= centerY - 5; y++) {
            int rgb = frame.rgb(x, y);
            if (rgb == UNKNOWN) return UNKNOWN;
            baselineTotal += maxChannel(rgb);
            baselineCount++;
        }
        for (int y = centerY + 6; y <= centerY + 11; y++) {
            int rgb = frame.rgb(x, y);
            if (rgb == UNKNOWN) return UNKNOWN;
            baselineTotal += maxChannel(rgb);
            baselineCount++;
        }
        int baseline = baselineCount == 0 ? 0 : (int) (baselineTotal / baselineCount);
        return lineMax - baseline >= CONTROL_STROKE_CONTRAST ? 1 : 0;
    }

    private static int fastStrokeColumnHit(NativeFrame frame, int x, int centerY) {
        int lineMax = 0;
        for (int y = centerY - 1; y <= centerY + 1; y++) {
            int rgb = frame.rgb(x, y);
            if (rgb == UNKNOWN) return UNKNOWN;
            lineMax = Math.max(lineMax, maxChannel(rgb));
        }
        int above = frame.rgb(x, centerY - 8);
        int below = frame.rgb(x, centerY + 8);
        if (above == UNKNOWN || below == UNKNOWN) return UNKNOWN;
        int baseline = (maxChannel(above) + maxChannel(below)) / 2;
        return lineMax - baseline >= CONTROL_STROKE_CONTRAST ? 1 : 0;
    }

    private static int maxChannel(int rgb) {
        int red = (rgb >> 16) & 0xff;
        int green = (rgb >> 8) & 0xff;
        int blue = rgb & 0xff;
        return Math.max(red, Math.max(green, blue));
    }

    private static String sha256(String text) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(text.getBytes(StandardCharsets.US_ASCII));
            StringBuilder out = new StringBuilder(digest.length * 2);
            for (byte value : digest) out.append(String.format("%02x", value & 0xff));
            return out.toString();
        } catch (NoSuchAlgorithmException error) {
            throw new AssertionError(error);
        }
    }
}
