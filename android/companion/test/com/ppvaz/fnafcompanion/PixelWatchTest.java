package com.ppvaz.fnafcompanion;

/** Host-only regression for the FNaF 2 legacy camera watch and control strokes. */
public final class PixelWatchTest {
    private static int failures;

    private static void check(String what, boolean condition) {
        if (!condition) {
            System.out.println("FAIL " + what);
            failures++;
        }
    }

    static final class Frame implements NativeFrame {
        private final int width;
        private final int height;
        private final int[] cells;

        Frame(int width, int height, int fill) {
            this.width = width;
            this.height = height;
            this.cells = new int[width * height];
            java.util.Arrays.fill(cells, fill);
        }

        void set(int x, int y, int rgb) { cells[y * width + x] = rgb; }
        @Override public int width() { return width; }
        @Override public int height() { return height; }
        @Override public int rgb(int x, int y) {
            return x < 0 || y < 0 || x >= width || y >= height
                    ? NativeFrame.UNKNOWN : cells[y * width + x];
        }
    }

    static void drawControlStrokes(Frame frame, boolean maskControl, int rgb) {
        int buttonX = maskControl ? PixelWatch.MASK_BUTTON_X : PixelWatch.MONITOR_BUTTON_X;
        int start = buttonX + (maskControl
                ? PixelWatch.MASK_STROKE_X_START : PixelWatch.MONITOR_STROKE_X_START);
        int center = buttonX + (maskControl
                ? PixelWatch.MASK_STROKE_X_CENTER : PixelWatch.MONITOR_STROKE_X_CENTER);
        int end = buttonX + (maskControl
                ? PixelWatch.MASK_STROKE_X_END : PixelWatch.MONITOR_STROKE_X_END);
        for (int x = start; x <= end; x++) {
            int offset = x <= center
                    ? PixelWatch.CONTROL_STROKE_Y_BASE
                            + (PixelWatch.CONTROL_STROKE_Y_PEAK
                                    - PixelWatch.CONTROL_STROKE_Y_BASE)
                                    * (x - start) / (center - start)
                    : PixelWatch.CONTROL_STROKE_Y_BASE
                            + (PixelWatch.CONTROL_STROKE_Y_PEAK
                                    - PixelWatch.CONTROL_STROKE_Y_BASE)
                                    * (end - x) / (end - center);
            for (int line = 0; line < 2; line++) {
                int y = PixelWatch.CONTROL_BUTTON_Y + offset
                        + line * PixelWatch.CONTROL_STROKE_LINE_OFFSET;
                for (int yy = y - PixelWatch.CONTROL_STROKE_RADIUS;
                        yy <= y + PixelWatch.CONTROL_STROKE_RADIUS; yy++) {
                    frame.set(x, yy, rgb);
                }
            }
        }
    }

    public static void main(String[] args) {
        PixelWatch.Spec spec = PixelWatch.defaultSpec();
        check("the watch is exactly the twelve map buttons", spec.size() == 12);
        check("the map buttons keep their measured names and centres",
                spec.entry(0).name.equals("cam01_button")
                        && spec.entry(11).name.equals("cam12_button")
                        && spec.entry(6).x == 1776 && spec.entry(6).y == 606);
        for (int camera = 1; camera <= 12; camera++) {
            check("cam " + camera + " is the canonical profile point",
                    PixelWatch.isCanonicalCameraButton(spec.entry(camera - 1), camera));
        }
        // The camera rule names these entries and their pixel-watch-v1 rows;
        // the row format is what WATCH <sha> hashes.
        check("canonical rows keep the pixel-watch-v1 format",
                spec.canonical().startsWith("pixel-watch-v1\ncam01_button|PIXEL|1412|784|1|1|YELLOWNESS|1|0\n"));
        check("spec hash is stable and lowercase sha256",
                spec.sha256().matches("[0-9a-f]{64}")
                        && spec.sha256().equals(PixelWatch.defaultSpec().sha256()));

        Frame frame = new Frame(PixelWatch.NATIVE_WIDTH, PixelWatch.NATIVE_HEIGHT, 0x808080);
        frame.set(1776, 606, 0xc2dd00);
        int[] values = new int[spec.size()];
        check("readInto fills every entry", PixelWatch.readInto(spec, frame, values) == spec.size());
        check("an unselected map button reads grey, not yellow",
                values[spec.indexOfName("cam01_button")] == 0);
        check("the lit CAM 07 button reads the measured selected yellowness",
                values[spec.indexOfName("cam07_button")] == 194);
        PixelWatch.Entry outside = new PixelWatch.Entry("outside", 99, 99);
        check("out-of-frame watch refuses with UNKNOWN",
                PixelWatch.read(outside, new Frame(10, 10, 0)) == PixelWatch.UNKNOWN);

        Frame chevrons = new Frame(PixelWatch.NATIVE_WIDTH, PixelWatch.NATIVE_HEIGHT, 0x202020);
        drawControlStrokes(chevrons, true, 0xff90a0);
        drawControlStrokes(chevrons, false, 0xffffff);
        check("fixed mask chevron stroke coverage is observed without ROI luma",
                PixelWatch.controlDownStrokeScore(chevrons, true) >= 100);
        check("fixed monitor chevron stroke coverage is observed without ROI luma",
                PixelWatch.controlDownStrokeScore(chevrons, false) >= 100);
        check("trace sparse mask chevron sampler preserves the visible band",
                PixelWatch.controlDownStrokeScoreFast(chevrons, true) >= 100);
        check("trace sparse monitor chevron sampler preserves the visible band",
                PixelWatch.controlDownStrokeScoreFast(chevrons, false) >= 100);
        Frame brightBackground = new Frame(PixelWatch.NATIVE_WIDTH, PixelWatch.NATIVE_HEIGHT, 0xffffff);
        check("uniform translucent-control background does not fake a stroke",
                PixelWatch.controlDownStrokeScore(brightBackground, true) == 0
                        && PixelWatch.controlDownStrokeScore(brightBackground, false) == 0);
        check("non-native stroke source is refused",
                PixelWatch.controlDownStrokeScore(new Frame(100, 100, 0), true)
                        == PixelWatch.UNKNOWN);
        check("both bottom strokes identify the unmasked office",
                PixelWatch.controlState(140, 140) == PixelWatch.ControlState.OFFICE_UNMASKED);
        check("mask stroke absent plus monitor stroke visible identifies monitor up",
                PixelWatch.controlState(0, 140) == PixelWatch.ControlState.MONITOR_UP);
        check("monitor stroke absent plus mask stroke visible identifies mask on",
                PixelWatch.controlState(140, 0) == PixelWatch.ControlState.MASK_ON);
        check("partial bottom strokes refuse a surface state",
                PixelWatch.controlState(60, 80) == PixelWatch.ControlState.UNKNOWN);

        Frame bar = new Frame(PixelWatch.NATIVE_WIDTH, PixelWatch.NATIVE_HEIGHT, 0);
        for (int y = PixelWatch.MASK_BUTTON_Y;
                y < PixelWatch.MASK_BUTTON_Y + PixelWatch.MASK_BUTTON_HEIGHT;
                y += PixelWatch.CONTROL_BUTTON_STEP) {
            for (int x = PixelWatch.MASK_BUTTON_X;
                    x < PixelWatch.MASK_BUTTON_X + PixelWatch.MASK_BUTTON_WIDTH;
                    x += PixelWatch.CONTROL_BUTTON_STEP) {
                bar.set(x, y, 0xffffff);
            }
        }
        check("the frozen trace block mean reads a visible sparse bar",
                PixelWatch.blockLuma(bar, PixelWatch.MASK_BUTTON_X, PixelWatch.MASK_BUTTON_Y,
                        PixelWatch.MASK_BUTTON_X + PixelWatch.MASK_BUTTON_WIDTH,
                        PixelWatch.MASK_BUTTON_Y + PixelWatch.MASK_BUTTON_HEIGHT,
                        PixelWatch.CONTROL_BUTTON_STEP) == 255);

        if (failures > 0) {
            System.out.println(failures + " check(s) failed");
            System.exit(1);
        }
        System.out.println("PixelWatchTest: all checks passed");
    }
}
