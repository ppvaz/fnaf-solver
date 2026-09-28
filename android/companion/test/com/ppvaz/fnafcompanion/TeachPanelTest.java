package com.ppvaz.fnafcompanion;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.BitSet;
import java.util.function.IntBinaryOperator;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Phone-free proof that the FNaF 2 teach panel sits outside what the helper
 * reads.
 *
 * <p>Every native reader the FNaF 2 legacy module runs per frame is driven
 * over a frame that records each pixel it is asked for. A reader either stays
 * at least GUARD_PX away from the panel, or it is the one the service
 * withholds while the panel may be on screen (the native lifecycle labels) --
 * and the test also proves that one DOES reach the panel, so the withheld list
 * cannot silently go stale in either direction.</p>
 */
public final class TeachPanelTest {
    private static int failures;
    private static final int W = PixelWatch.NATIVE_WIDTH;
    private static final int H = PixelWatch.NATIVE_HEIGHT;

    private static void check(String what, boolean ok) {
        if (!ok) {
            System.out.println("FAIL " + what);
            failures++;
        }
    }

    /** Answers with a synthetic image and remembers every pixel read. */
    static final class RecordingFrame implements NativeFrame {
        final BitSet read = new BitSet(W * H);
        private final IntBinaryOperator image;

        RecordingFrame(IntBinaryOperator image) {
            this.image = image;
        }

        @Override public int width() { return W; }
        @Override public int height() { return H; }

        @Override public int rgb(int x, int y) {
            if (x < 0 || y < 0 || x >= W || y >= H) return PixelWatch.UNKNOWN;
            read.set(y * W + x);
            return image.applyAsInt(x, y) & 0xffffff;
        }

        /** Nearest recorded read to the panel, in pixels; MAX_VALUE if none. */
        int nearest() {
            int best = Integer.MAX_VALUE;
            for (int i = read.nextSetBit(0); i >= 0; i = read.nextSetBit(i + 1)) {
                best = Math.min(best, TeachPanel.distance(i % W, i / W));
            }
            return best;
        }

        int count() {
            return read.cardinality();
        }
    }

    /** A handful of images so every branch that reads more pixels is reached. */
    private static final IntBinaryOperator[] IMAGES = {
            (x, y) -> 0x000000,
            (x, y) -> 0xffffff,
            (x, y) -> 0x7f7f7f,
            // A night-like office: lit meter compartments, pink bottom bars,
            // warm ceiling bulb, and the stroke chevrons' contrast.
            (x, y) -> y < 110 && x < 300 ? 0xf0f0f0
                    : y >= 1000 ? 0xe07090
                    : y < 220 ? 0xc08040 : 0x141010,
            // Stripes, so contrast tests and component searches see edges.
            (x, y) -> ((x / 7 + y / 5) & 1) == 0 ? 0xffe0a0 : 0x100000,
    };

    private interface Reader {
        void run(RecordingFrame frame);
    }

    private static RecordingFrame footprint(Reader reader) {
        RecordingFrame union = new RecordingFrame((x, y) -> 0);
        for (IntBinaryOperator image : IMAGES) {
            RecordingFrame frame = new RecordingFrame(image);
            reader.run(frame);
            union.read.or(frame.read);
        }
        return union;
    }

    private static void clear(String reader, Reader body) {
        RecordingFrame frame = footprint(body);
        check(reader + " reads pixels (the harness reached it)", frame.count() > 0);
        int nearest = frame.nearest();
        check(reader + " stays " + TeachPanel.GUARD_PX + " px from the teach panel (nearest "
                + nearest + ")", nearest >= TeachPanel.GUARD_PX);
    }

    private static void withheld(String reader, Reader body) {
        RecordingFrame frame = footprint(body);
        check(reader + " is on the withheld list because it DOES reach the panel",
                frame.nearest() < TeachPanel.GUARD_PX);
    }

    private static int[] grid(int background, int[][] cells) {
        int[] grid = new int[PixelWatch.GRID_WIDTH * PixelWatch.GRID_HEIGHT];
        java.util.Arrays.fill(grid, background);
        for (int[] cell : cells) grid[cell[1] * PixelWatch.GRID_WIDTH + cell[0]] = cell[2];
        return grid;
    }

    private static int blend(int ink, int under, int alpha) {
        int r = (((ink >> 16) & 0xff) * alpha + ((under >> 16) & 0xff) * (255 - alpha)) / 255;
        int g = (((ink >> 8) & 0xff) * alpha + ((under >> 8) & 0xff) * (255 - alpha)) / 255;
        int b = ((ink & 0xff) * alpha + (under & 0xff) * (255 - alpha)) / 255;
        return (r << 16) | (g << 8) | b;
    }

    private static int modelInt(String json, String key) {
        Matcher m = Pattern.compile("\"" + key + "\"\\s*:\\s*(\\d+)").matcher(json);
        if (!m.find()) throw new IllegalStateException("model has no " + key);
        return Integer.parseInt(m.group(1));
    }

    public static void main(String[] args) throws IOException {
        // The service's own per-frame reads, each through the shared helper
        // CaptureService calls.
        clear("20x9 grid", frame -> {
            for (int gy = 0; gy < PixelWatch.GRID_HEIGHT; gy++) {
                for (int gx = 0; gx < PixelWatch.GRID_WIDTH; gx++) {
                    frame.rgb(PixelWatch.gridSampleX(gx, W), PixelWatch.gridSampleY(gy, H));
                }
            }
        });
        clear("mask control block (trace column)", frame -> PixelWatch.blockLuma(frame,
                PixelWatch.MASK_BUTTON_X, PixelWatch.MASK_BUTTON_Y,
                PixelWatch.MASK_BUTTON_X + PixelWatch.MASK_BUTTON_WIDTH,
                PixelWatch.MASK_BUTTON_Y + PixelWatch.MASK_BUTTON_HEIGHT,
                PixelWatch.CONTROL_BUTTON_STEP));
        clear("monitor control block (trace column)", frame -> PixelWatch.blockLuma(frame,
                PixelWatch.MONITOR_BUTTON_X, PixelWatch.MONITOR_BUTTON_Y,
                PixelWatch.MONITOR_BUTTON_X + PixelWatch.MONITOR_BUTTON_WIDTH,
                PixelWatch.MONITOR_BUTTON_Y + PixelWatch.MONITOR_BUTTON_HEIGHT,
                PixelWatch.CONTROL_BUTTON_STEP));
        clear("control strokes", frame -> {
            PixelWatch.controlDownStrokeScore(frame, true);
            PixelWatch.controlDownStrokeScore(frame, false);
            PixelWatch.controlDownStrokeScoreFast(frame, true);
            PixelWatch.controlDownStrokeScoreFast(frame, false);
        });

        PixelWatch.Spec spec = PixelWatch.defaultSpec();
        for (int i = 0; i < spec.size(); i++) {
            PixelWatch.Entry entry = spec.entry(i);
            clear("watch " + entry.name, frame -> PixelWatch.read(entry, frame));
        }

        // The legacy module as the service runs it: every reader of the full
        // pass while the panel may show (lifecycle withheld), and of the
        // trace pass, clears the panel; with the panel hidden, the full pass
        // does reach it -- through the lifecycle labels, which is why they
        // are withheld.
        Fnaf2Legacy legacy = new Fnaf2Legacy(3);
        check("the legacy watch loads", legacy.watchCommand(legacy.watchSpec().sha256(), true)
                .startsWith("OK watch=ACTIVE"));
        clear("Fnaf2Legacy full pass while the panel may show",
                frame -> legacy.onFrame(frame, 1L, 1L, 1L, true, false));
        clear("Fnaf2Legacy trace pass", frame -> legacy.onTraceFrame(frame, 1L, 1L, 1L));
        withheld("Fnaf2Legacy full pass with the panel hidden",
                frame -> legacy.onFrame(frame, 1L, 1L, 1L, false, false));

        // Identity is grid-first. On a frame the grid already calls a night --
        // the only frames the panel is drawn over -- the native frame is never
        // consulted at all.
        int[] night = grid(0x101010, new int[][] {{0, 0, 0xffffff}, {1, 0, 0xffffff}});
        check("the synthetic night grid classifies as FNAF2_NIGHT",
                ScreenIdentity.classify(night) == ScreenIdentity.FNAF2_NIGHT);
        RecordingFrame nightFrame = footprint(frame -> ScreenIdentity.classify(frame, night));
        check("a night grid reads no native pixel", nightFrame.count() == 0);
        // Lifecycle labels need the native frame and do reach the panel; the
        // service falls back to the grid-only identity while it may be shown.
        int[] dark = grid(0x000000, new int[0][]);
        check("an all-dark grid is UNKNOWN to the grid identity",
                ScreenIdentity.classify(dark) == ScreenIdentity.UNKNOWN);
        withheld("native lifecycle identity", frame -> ScreenIdentity.classify(frame, dark));

        // Palette: nothing the panel can paint -- an ink, an antialiased edge of
        // an ink over the fill, or one ink over another -- looks like a selected
        // camera button to the video grader.
        int[] palette = TeachPanel.palette();
        for (int ink : palette) {
            check(String.format("ink %06x is not grader-yellow", ink & 0xffffff),
                    !TeachPanel.graderYellow(ink));
            for (int under : palette) {
                for (int alpha = 0; alpha <= 255; alpha++) {
                    if (TeachPanel.graderYellow(blend(ink, under, alpha))) {
                        check(String.format("ink %06x over %06x at alpha %d is not grader-yellow",
                                ink & 0xffffff, under & 0xffffff, alpha), false);
                        alpha = 256;
                    }
                }
            }
        }
        check("the fill is opaque", (TeachPanel.FILL >>> 24) == 0xff);

        // Geometry: the declared model and the class agree, and the panel is
        // on the frame.
        String model = new String(Files.readAllBytes(Paths.get(System.getProperty(
                "teach.model", "tools/device/models/teach-panel-v1.json"))),
                StandardCharsets.UTF_8);
        check("model schema", model.contains("\"schema\": \"" + TeachPanel.VERSION + "\""));
        check("model left", modelInt(model, "left") == TeachPanel.LEFT);
        check("model top", modelInt(model, "top") == TeachPanel.TOP);
        check("model right", modelInt(model, "right") == TeachPanel.RIGHT);
        check("model bottom", modelInt(model, "bottom") == TeachPanel.BOTTOM);
        check("model guard", modelInt(model, "guardPx") == TeachPanel.GUARD_PX);
        check("panel lies on the native frame", TeachPanel.LEFT >= 0 && TeachPanel.TOP >= 0
                && TeachPanel.RIGHT <= W && TeachPanel.BOTTOM <= H
                && TeachPanel.WIDTH > 0 && TeachPanel.HEIGHT > 0);
        check("distance is zero inside", TeachPanel.distance(TeachPanel.LEFT, TeachPanel.TOP) == 0
                && TeachPanel.distance(TeachPanel.RIGHT - 1, TeachPanel.BOTTOM - 1) == 0);
        check("distance counts pixels outside", TeachPanel.distance(TeachPanel.RIGHT - 1
                + TeachPanel.GUARD_PX, TeachPanel.TOP) == TeachPanel.GUARD_PX);

        if (failures > 0) {
            System.out.println("TeachPanelTest: " + failures + " failure(s)");
            System.exit(1);
        }
        System.out.println("TeachPanelTest: every native reader clears the teach panel or is withheld");
    }
}
