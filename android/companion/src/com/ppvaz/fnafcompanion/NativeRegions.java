package com.ppvaz.fnafcompanion;

import java.util.Locale;

/**
 * Small native-resolution regions of every captured frame, returned as the
 * frame's own pixels.
 *
 * <p>This is the helper's observation primitive. A reader registers a few
 * rectangles in native display coordinates; the capture thread copies each
 * one's pixels out of every native frame it processes, and a read returns the
 * newest complete set together with that frame's image timestamp and
 * sequence. There is no reducer here -- no mean, no luma, no grid. A detector
 * that decides "Bonnie is in the lit doorway" or "CAM 4B is selected" is
 * calibrated on the host against these pixels, where its rule can be tested
 * and versioned, and the helper only has to be fast and faithful.</p>
 *
 * <p>A region may be sampled with a stride ({@code step}) so a large area
 * stays cheap; every returned value is still one unblended native pixel.
 * Registration is bounded so a read always fits one control-socket line.</p>
 *
 * <p>No Android dependency: {@link NativeFrame} is the only input, so the
 * whole contract is exercised on the host by {@code NativeRegionsTest}.</p>
 */
public final class NativeRegions {
    public static final int MAX_REGIONS = 16;
    /** Total samples across all regions: 8192 * 6 hex chars is a 48 KiB line. */
    public static final int MAX_TOTAL_SAMPLES = 8192;
    public static final int MAX_STEP = 64;

    private static final class Region {
        final String name;
        final int x;
        final int y;
        final int width;
        final int height;
        final int step;
        final int cols;
        final int rows;
        int[] front;
        int[] back;

        Region(String name, int x, int y, int width, int height, int step) {
            this.name = name;
            this.x = x;
            this.y = y;
            this.width = width;
            this.height = height;
            this.step = step;
            this.cols = (width + step - 1) / step;
            this.rows = (height + step - 1) / step;
            this.back = new int[cols * rows];
        }

        int samples() { return cols * rows; }
    }

    private final int frameWidth;
    private final int frameHeight;
    // Copy-on-write: the capture thread reads this reference once per frame,
    // the control thread replaces it, and neither blocks the other.
    private volatile Region[] active = new Region[0];
    private long frontSequence = -1;
    private long frontImageNs = -1;
    private long frontCopiedNs = -1;
    private long captured;

    public NativeRegions(int frameWidth, int frameHeight) {
        this.frameWidth = frameWidth;
        this.frameHeight = frameHeight;
    }

    /** Register or replace a region. Returns null, or the refusal reason. */
    public synchronized String set(String name, int x, int y, int width, int height, int step) {
        if (name == null || !name.matches("[a-z][a-z0-9_]{0,31}")) return "region-name";
        if (step < 1 || step > MAX_STEP) return "region-step";
        if (width < 1 || height < 1 || x < 0 || y < 0
                || x + width > frameWidth || y + height > frameHeight) {
            return "region-bounds";
        }
        Region fresh = new Region(name, x, y, width, height, step);
        Region[] current = active;
        int total = fresh.samples();
        int kept = 0;
        for (Region region : current) {
            if (!region.name.equals(name)) {
                total += region.samples();
                kept++;
            }
        }
        if (kept + 1 > MAX_REGIONS) return "region-count";
        if (total > MAX_TOTAL_SAMPLES) return "region-samples";
        Region[] next = new Region[kept + 1];
        int index = 0;
        for (Region region : current) {
            if (!region.name.equals(name)) next[index++] = region;
        }
        next[index] = fresh;
        active = next;
        return null;
    }

    public synchronized void clear() {
        active = new Region[0];
        frontSequence = -1;
        frontImageNs = -1;
        frontCopiedNs = -1;
    }

    public int size() { return active.length; }

    /** Samples across every registered region. */
    public int samples() {
        int total = 0;
        for (Region region : active) total += region.samples();
        return total;
    }

    /** Frames copied since the service started. */
    public synchronized long captured() { return captured; }

    /** One registered region's sampled footprint in native pixels. */
    public static final class Footprint {
        public final String name;
        /** [left, right) x [top, bottom) of the pixels the region reads. */
        public final int left;
        public final int top;
        public final int right;
        public final int bottom;

        Footprint(String name, int left, int top, int right, int bottom) {
            this.name = name;
            this.left = left;
            this.top = top;
            this.right = right;
            this.bottom = bottom;
        }
    }

    /**
     * Every registered region's footprint, from one consistent registration,
     * for the teach panels' clearance check. The footprint ends at the last
     * sampled pixel, not the requested edge: a strided region reads nothing
     * beyond {@code x + (cols - 1) * step}.
     */
    public Footprint[] footprints() {
        Region[] regions = active;
        Footprint[] out = new Footprint[regions.length];
        for (int i = 0; i < regions.length; i++) {
            Region region = regions[i];
            out[i] = new Footprint(region.name, region.x, region.y,
                    region.x + (region.cols - 1) * region.step + 1,
                    region.y + (region.rows - 1) * region.step + 1);
        }
        return out;
    }

    /**
     * Capture thread: copy every active region out of {@code frame}. Returns
     * false, and publishes nothing, if any sample fell outside the frame --
     * a partial set would be read as a real one.
     */
    public boolean capture(NativeFrame frame, long sequence, long imageNs, long nowNs) {
        Region[] regions = active;
        if (regions.length == 0) return true;
        if (frame.width() != frameWidth || frame.height() != frameHeight) return false;
        for (Region region : regions) {
            int out = 0;
            for (int row = 0; row < region.rows; row++) {
                int py = region.y + row * region.step;
                for (int col = 0; col < region.cols; col++) {
                    int rgb = frame.rgb(region.x + col * region.step, py);
                    if (rgb == NativeFrame.UNKNOWN) return false;
                    region.back[out++] = rgb;
                }
            }
        }
        synchronized (this) {
            if (active != regions) return false;         // replaced mid-copy: skip this frame
            for (Region region : regions) {
                int[] swap = region.front;
                region.front = region.back;
                region.back = swap != null ? swap : new int[region.samples()];
            }
            frontSequence = sequence;
            frontImageNs = imageNs;
            frontCopiedNs = nowNs;
            captured++;
        }
        return true;
    }

    /**
     * {@code seq=N imageNs=T copiedNs=C regions=K name=x,y,w,h,step:HEX ...}
     * where HEX is RRGGBB per sample, row-major. {@code seq=-1} means no frame
     * has been copied since the regions were set.
     */
    public synchronized String read() {
        Region[] regions = active;
        StringBuilder out = new StringBuilder(64 + 7 * MAX_TOTAL_SAMPLES);
        boolean ready = frontSequence >= 0;
        for (Region region : regions) {
            if (region.front == null) ready = false;
        }
        out.append("seq=").append(ready ? frontSequence : -1)
                .append(" imageNs=").append(ready ? frontImageNs : -1)
                .append(" copiedNs=").append(ready ? frontCopiedNs : -1)
                .append(" captured=").append(captured)
                .append(" regions=").append(regions.length);
        if (!ready) return out.toString();
        for (Region region : regions) {
            out.append(' ').append(region.name).append('=')
                    .append(String.format(Locale.ROOT, "%d,%d,%d,%d,%d",
                            region.x, region.y, region.width, region.height, region.step))
                    .append(':');
            NativeFrame.appendRgbHex(out, region.front);
        }
        return out.toString();
    }
}
