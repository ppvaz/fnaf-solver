package com.ppvaz.fnafcompanion;

/**
 * Where the teach panel may paint, and with which colours.
 *
 * <p>The panel is its own window, exactly this rectangle, so WindowManager
 * clips every pixel it draws to it. The rectangle is the largest strip on the
 * left of the office that no reader of the frame samples: it sits between the
 * FNaF 2 legacy grid rows at y = 300 and y = 420, and clear of the host night
 * predicate's rows, the lifecycle boxes, and the video grader's clock band
 * (y >= 432) and mask bar. Those
 * claims are tests, not comments: TeachPanelTest drives every helper reader
 * over a recording frame, and tools/device/test-teach-panel-clearance.py
 * checks the host readers. The rectangle itself is declared once, in
 * tools/device/models/teach-panel-v1.json, and both tests read it.</p>
 *
 * <p>The palette is chosen against the video grader's selected-camera rule
 * (r > 150 and g > 150 and b < 110 anywhere in the frame): no ink, and no
 * antialiased blend of an ink over the opaque fill, can satisfy it. The
 * trainer's amber light colour does, so the panel's light ink is paler. That
 * covers what the panel paints, not what shows through it: the platform caps
 * the window at 0.8 opacity (measured on the g56), so a teach video is graded
 * with this rectangle blanked (run-timeline.py --exclude-rect).</p>
 *
 * <p>Pure Java: no Android types, so android/companion/test.sh runs it on the
 * host.</p>
 */
public final class TeachPanel {
    public static final String VERSION = "teach-panel-v1";
    /** Native 2400x1080 content pixels, [left, right) x [top, bottom). */
    public static final int LEFT = 10;
    public static final int TOP = 310;
    public static final int RIGHT = 590;
    public static final int BOTTOM = 410;
    public static final int WIDTH = RIGHT - LEFT;
    public static final int HEIGHT = BOTTOM - TOP;
    /** Minimum distance from the panel to any sampled pixel. */
    public static final int GUARD_PX = 10;
    /**
     * Frames captured this long after the panel detached may still show it:
     * a margin over the removal's few compositor frames.
     */
    public static final long WITHHOLD_AFTER_DETACH_NS = 100_000_000L;

    public static final int FILL = 0xFF080A08;
    public static final int INK_TEXT = 0xFFF2F2EE;
    public static final int INK_DIM = 0xFF969EAA;
    public static final int INK_IDLE = 0xFF3C443A;
    public static final int INK_TRACK = 0xFF1C201C;
    public static final int INK_MASK = 0xFFFF5449;
    public static final int INK_MONITOR = 0xFFC9D2C3;
    public static final int INK_CAM = 0xFF4FD2EE;
    public static final int INK_LIGHT = 0xFFFFD2A8;
    public static final int INK_WIND = 0xFFC983F5;

    private TeachPanel() {
    }

    public static int ink(CycleLesson.Ink ink) {
        switch (ink) {
            case MASK: return INK_MASK;
            case MONITOR: return INK_MONITOR;
            case CAM: return INK_CAM;
            case LIGHT: return INK_LIGHT;
            case WIND: return INK_WIND;
            default: throw new IllegalArgumentException("ink");
        }
    }

    public static int surface(CycleLesson.Surface surface) {
        switch (surface) {
            case MASK: return INK_MASK;
            case CAMS: return INK_MONITOR;
            case OFFICE: return INK_IDLE;
            default: throw new IllegalArgumentException("surface");
        }
    }

    /** Every colour the panel paints at full coverage. */
    public static int[] palette() {
        return new int[] {FILL, INK_TEXT, INK_DIM, INK_IDLE, INK_TRACK, INK_MASK,
                INK_MONITOR, INK_CAM, INK_LIGHT, INK_WIND};
    }

    /** True when the pixel (x, y), in native content pixels, is inside the panel. */
    public static boolean contains(int x, int y) {
        return x >= LEFT && x < RIGHT && y >= TOP && y < BOTTOM;
    }

    /** Distance in pixels from (x, y) to the panel, 0 inside it. */
    public static int distance(int x, int y) {
        int dx = x < LEFT ? LEFT - x : x >= RIGHT ? x - (RIGHT - 1) : 0;
        int dy = y < TOP ? TOP - y : y >= BOTTOM ? y - (BOTTOM - 1) : 0;
        return Math.max(dx, dy);
    }

    /** The video grader's selected-camera test, run-timeline.py yellow_pixels(). */
    public static boolean graderYellow(int rgb) {
        int r = (rgb >> 16) & 0xff;
        int g = (rgb >> 8) & 0xff;
        int b = rgb & 0xff;
        return r > 150 && g > 150 && b < 110;
    }
}
