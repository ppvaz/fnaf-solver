package com.ppvaz.fnafcompanion;

/** Phone-free regression for the Cue Helper screen identity gate. */
public final class ScreenIdentityTest {
    private static int failures;

    private static final class ArrayFrame implements NativeFrame {
        private final int[] pixels = new int[PixelWatch.NATIVE_WIDTH
                * PixelWatch.NATIVE_HEIGHT];

        ArrayFrame(int colour) {
            for (int index = 0; index < pixels.length; index++) pixels[index] = colour;
        }

        void fill(int x0, int y0, int x1, int y1, int colour) {
            for (int y = y0; y < y1; y++) {
                for (int x = x0; x < x1; x++) {
                    pixels[y * PixelWatch.NATIVE_WIDTH + x] = colour;
                }
            }
        }

        @Override public int width() { return PixelWatch.NATIVE_WIDTH; }
        @Override public int height() { return PixelWatch.NATIVE_HEIGHT; }

        @Override public int rgb(int x, int y) {
            return x < 0 || y < 0 || x >= width() || y >= height()
                    ? PixelWatch.UNKNOWN
                    : pixels[y * width() + x];
        }
    }

    private static void check(String what, boolean ok) {
        if (!ok) {
            System.out.println("FAIL " + what);
            failures++;
        }
    }

    private static int[] filled(int colour) {
        int[] grid = new int[PixelWatch.GRID_WIDTH * PixelWatch.GRID_HEIGHT];
        for (int i = 0; i < grid.length; i++) grid[i] = colour;
        return grid;
    }

    private static void put(int[] grid, int x, int y, int colour) {
        grid[y * PixelWatch.GRID_WIDTH + x] = colour;
    }

    private static int[] landscapeHelper() {
        int[] grid = filled(0x120a0b);
        for (int x = 1; x < PixelWatch.GRID_WIDTH; x++) {
            put(grid, x, 2, 0x1f1012);
            put(grid, x, 7, 0x1f1012);
        }
        put(grid, 16, 3, 0x5f3989); // Bonnie
        put(grid, 16, 4, 0x6f422b); // Freddy
        put(grid, 16, 5, 0xd3a623); // Chica
        put(grid, 8, 1, 0xffb020);
        put(grid, 9, 1, 0xffb020);
        return grid;
    }

    private static int[] portraitHelper() {
        int[] grid = filled(0x120a0b);
        for (int x = 1; x < 19; x++) put(grid, x, 3, 0x1f1012);
        for (int x = 1; x < 19; x++) put(grid, x, 5, 0x6f422b); // Freddy
        for (int x = 1; x < 19; x++) put(grid, x, 6, 0xb23a59); // Mangle
        return grid;
    }

    private static int[] nightWithFlash() {
        int[] grid = filled(0x0e0e10);
        put(grid, 0, 0, 0xf0f0f0);
        put(grid, 1, 0, 0xf0f0f0);
        return grid;
    }

    private static int[] nightWithMask() {
        int[] grid = filled(0x0e0e10);
        for (int x = 1; x < 10; x++) put(grid, x, 8, 0xc85a78);
        return grid;
    }

    private static int[] titleMenu() {
        int[] grid = filled(0x0e0e10);
        put(grid, 3, 0, 0xf0f0f0);
        put(grid, 5, 1, 0xf0f0f0);
        put(grid, 7, 2, 0xf0f0f0);
        put(grid, 3, 4, 0xf0f0f0);
        put(grid, 5, 5, 0xf0f0f0);
        return grid;
    }

    private static int[] ambiguousMenuWithRedAccent() {
        int[] grid = titleMenu();
        for (int x = 1; x < 10; x++) put(grid, x, 8, 0xc85a78);
        return grid;
    }

    private static ArrayFrame introCardFrame(boolean confetti) {
        ArrayFrame frame = new ArrayFrame(0x020202);
        // Sparse white clock/card strokes, matching the measured intro shape
        // without turning the synthetic frame into a bright block.
        for (int x = 900; x < 1500; x += 10) {
            frame.fill(x, 486, x + 6, 513, 0xffffff);
        }
        if (confetti) {
            for (int x = 200; x < 2200; x += 400) {
                frame.fill(x, 60, x + 12, 72, 0xf04070);
            }
        }
        return frame;
    }

    private static ArrayFrame gameOverFrame() {
        ArrayFrame frame = new ArrayFrame(0x101010);
        frame.fill(650, 450, 1750, 920, 0xd02020);
        frame.fill(900, 950, 1450, 1040, 0xffffff);
        return frame;
    }

    // -- Captured frames -----------------------------------------------------
    // The synthetic titleMenu() above leaves cells (0,0) and (1,0) dark, which
    // is exactly the pair nightScore reads as the lit flashlight meter -- so it
    // could never provoke the failure these fixtures pin. On 2026-09-05 the
    // service reported FNAF2_NIGHT on 24 consecutive live grids while the
    // operator was looking at the menu, and the host used that field as its
    // positive gate. These are three of those grids, verbatim.

    /** Live moto g56 grid seq=21055, operator-labelled FNAF2_MENU;
     * the helper reported FNAF2_NIGHT for it. */
    private static int[] capturedMenu0() {
        return new int[] {
            0x131313, 0xffffff, 0xffffff, 0x0b0b0b, 0x4a4a4a, 0x0e0e0e, 0x050505, 0x2e2e2e, 0x050505, 0x262628, 0x07070a, 0x363636, 0x2e2e2e, 0x060606, 0x161716, 0x060606, 0x050505, 0x877671, 0x0e0b0c, 0x545454,
            0x282828, 0xffffff, 0xffffff, 0x3f3f3f, 0x3d3d3d, 0x5a5a5a, 0x2d2d2d, 0x4d4d4d, 0x2a292a, 0x282828, 0x4c4e53, 0x2e2e2e, 0x292829, 0x303030, 0x474747, 0x383737, 0x2e2e2c, 0x535252, 0x302f30, 0x303030,
            0x464646, 0x282828, 0x424242, 0x282828, 0x282828, 0x424242, 0x282828, 0x282828, 0x343434, 0x545049, 0x777a82, 0x3b424a, 0x6c7074, 0x282828, 0x2c2c2c, 0x766c65, 0x3a3938, 0x4b4a4b, 0x484848, 0x575757,
            0x464646, 0xffffff, 0x282828, 0x5c5c5c, 0x686868, 0x282828, 0x424242, 0x615952, 0x2e2c2d, 0x3a3a38, 0xc7cddd, 0x343337, 0x5c5c5c, 0x353535, 0x373533, 0x736b68, 0x333333, 0x515152, 0x414140, 0x585858,
            0x020202, 0x010101, 0x000000, 0x404040, 0x000000, 0x161616, 0x212121, 0xa3a09b, 0x323539, 0x2f3e52, 0x3b3b3b, 0x020202, 0x5d5c5d, 0x080808, 0x2b2420, 0x312624, 0x372e28, 0x474744, 0x5b5b5b, 0x060503,
            0x464646, 0x9e9e9e, 0xffffff, 0x383838, 0x5d5d5d, 0xffffff, 0x646464, 0x827577, 0x40403f, 0x7e7168, 0x6b6c70, 0x797c83, 0x46464a, 0x444444, 0x4f4f4f, 0x645d59, 0x474746, 0x5a5a5a, 0x454544, 0x545454,
            0x5e5e5e, 0x282828, 0x3b3b3b, 0x282828, 0x353535, 0x4c4c4c, 0x2a2a2a, 0x565655, 0x888a91, 0x918583, 0x2e2e2e, 0x4c494a, 0x4d4f56, 0x464646, 0x303030, 0x4f4947, 0x444444, 0x282828, 0x2a2a2a, 0x464646,
            0x1c1c1c, 0x2a2a2a, 0x383838, 0x363636, 0x030303, 0x595959, 0x040404, 0x0c0b03, 0x222527, 0x221b1f, 0x0e121d, 0x292325, 0x282828, 0x251d1c, 0x030303, 0x2e231e, 0x161613, 0x1d1c1a, 0x0f0f0f, 0x272727,
            0x000000, 0x000000, 0x252525, 0x090909, 0x000000, 0x6f6a60, 0x040401, 0x070706, 0x67768b, 0x34383e, 0x111111, 0x7c8290, 0x39302c, 0x1b1a19, 0x2a221f, 0x12100d, 0x191714, 0x4b4a48, 0x373737, 0x000000
        };
    }

    /** Live moto g56 grid seq=21058, operator-labelled FNAF2_MENU;
     * the helper reported FNAF2_NIGHT for it. */
    private static int[] capturedMenu1() {
        return new int[] {
            0x303030, 0xffffff, 0xffffff, 0x1a1a1a, 0x050505, 0x000000, 0x000000, 0x000000, 0x050505, 0x404143, 0x07070a, 0x000000, 0x303030, 0x060606, 0x060706, 0x171717, 0x282828, 0x5d4d48, 0x030101, 0x050505,
            0x101010, 0xffffff, 0xffffff, 0x1b1b1b, 0x020202, 0x262626, 0x000000, 0x101010, 0x424142, 0x020202, 0x3d3f45, 0x000000, 0x050505, 0x3e3e3e, 0x0b0b0b, 0x2e2c2c, 0x282726, 0x040303, 0x151415, 0x393939,
            0x000000, 0x616161, 0x000000, 0x333333, 0x000000, 0x080808, 0x292929, 0x353535, 0x020202, 0x443f36, 0x0c101a, 0x737b85, 0x3c4146, 0x262626, 0x2d2d2d, 0x5d5149, 0x060504, 0x1d1c1c, 0x000000, 0x333333,
            0x050505, 0xffffff, 0x000000, 0x000000, 0x000000, 0x000000, 0x252525, 0x352c24, 0x211f20, 0x242421, 0x798093, 0x2a2a2f, 0x070707, 0x161616, 0x686563, 0x4a403c, 0x000000, 0x282829, 0x131312, 0x060606,
            0x1c1c1c, 0x020202, 0x464646, 0x1d1d1d, 0x383838, 0x111111, 0x000000, 0xdad7d2, 0x6a6d71, 0x3f4d62, 0x100f0f, 0x000001, 0x080808, 0x090909, 0x342e29, 0x6f6462, 0x4e453f, 0x060603, 0x000000, 0x131210,
            0x040404, 0x929292, 0xffffff, 0x0f0f0f, 0x666666, 0xffffff, 0x242424, 0x675659, 0x101010, 0x46352b, 0x0c0e13, 0x4f525c, 0x101015, 0x161616, 0x5f5f5f, 0x3f3732, 0x10100f, 0x272727, 0x000000, 0x0c0c0c,
            0x535353, 0x151515, 0x585858, 0x292929, 0x161616, 0x101010, 0x525252, 0x010100, 0x70737a, 0x685a58, 0x4c4c4c, 0x262122, 0x21242d, 0x191919, 0x010101, 0x908886, 0x151514, 0x171717, 0x363636, 0x343434,
            0x020202, 0x020202, 0x000000, 0x000000, 0x080808, 0x020202, 0x020202, 0x15140c, 0x222527, 0x130c10, 0x1c202b, 0x20191c, 0x000000, 0x564e4d, 0x020202, 0x372d28, 0x242421, 0x0d0c0a, 0x444444, 0x000000,
            0x000000, 0x040404, 0x1b1b1b, 0x000000, 0x000000, 0x2e291e, 0x040401, 0x010100, 0x536176, 0x191d23, 0x101010, 0xa1a7b4, 0x39302c, 0x222120, 0x2a221f, 0x312e2b, 0x0a0805, 0x181715, 0x373737, 0x373737
        };
    }

    /** Live moto g56 grid seq=21063, operator-labelled FNAF2_MENU;
     * the helper reported FNAF2_NIGHT for it. */
    private static int[] capturedMenu2() {
        return new int[] {
            0x000000, 0xffffff, 0xffffff, 0x040404, 0x040404, 0x0b0b0b, 0x222222, 0x000000, 0x000000, 0x000102, 0x232326, 0x090909, 0x1b1b1b, 0x1b1b1b, 0x050605, 0x060606, 0x191919, 0x70605b, 0x1a1718, 0x000000,
            0x0c0c0c, 0xffffff, 0xffffff, 0x202020, 0x2b2b2b, 0x333333, 0x000000, 0x000000, 0x010000, 0x080808, 0x181a20, 0x040404, 0x131213, 0x0c0c0c, 0x080808, 0x3a3939, 0x201f1e, 0x0c0c0b, 0x1e1d1e, 0x171717,
            0x131313, 0x131313, 0x1b1b1b, 0x000000, 0x000000, 0x030303, 0x030303, 0x222222, 0x020202, 0x514c43, 0x141821, 0x141c26, 0x05090e, 0x181818, 0x2a2a2a, 0x83776f, 0x0f0e0d, 0x020102, 0x010101, 0x0e0e0e,
            0x040404, 0xffffff, 0x090909, 0x050505, 0x161616, 0x5e5e5e, 0x101010, 0x2b2219, 0x020001, 0x050503, 0x798093, 0x121217, 0x000000, 0x161616, 0x252220, 0x504642, 0x000000, 0x09090a, 0x1e1e1d, 0x4e4e4e,
            0x141414, 0x080808, 0x202020, 0x000000, 0x000000, 0x1e1e1e, 0x212121, 0xb3b0ab, 0x74777b, 0x324155, 0x030202, 0x000001, 0x141314, 0x010101, 0x3a332e, 0x423735, 0x504640, 0x50504d, 0x282828, 0x12110f,
            0x0d0d0d, 0x909090, 0xffffff, 0x000000, 0x101010, 0xffffff, 0x070707, 0x544446, 0x000000, 0x3d2c22, 0x121519, 0x70747e, 0x323237, 0x111111, 0x080808, 0x39302b, 0x141312, 0x010000, 0x000000, 0x000000,
            0x1d1d1d, 0x232323, 0x131313, 0x3a3a3a, 0x2e2e2e, 0x454545, 0x0e0e0e, 0x020202, 0x81848b, 0x6b5c5a, 0x202020, 0x040001, 0x292c35, 0x040404, 0x0a0a0a, 0x372f2d, 0x0b0b0a, 0x000000, 0x0f0f0f, 0x000000,
            0x292929, 0x0d0d0d, 0x000000, 0x040404, 0x161616, 0x080808, 0x191a19, 0x4d4c44, 0x222527, 0x170f14, 0x10141f, 0x282224, 0x3e3e3e, 0x625a59, 0x020202, 0x473d38, 0x070704, 0x262523, 0x282828, 0x030303,
            0x1b1b1b, 0x151515, 0x202020, 0x202020, 0x242424, 0x2b261c, 0x040401, 0x040403, 0x3b495e, 0x090d13, 0x000000, 0x777d8a, 0x655c58, 0x2b2a29, 0x312927, 0x12100d, 0x161411, 0x080705, 0x171717, 0x000000
        };
    }

    public static void main(String[] args) {
        check("landscape helper frame is identified",
                ScreenIdentity.classify(landscapeHelper()) == ScreenIdentity.CUE_HELPER);
        check("portrait helper frame is identified",
                ScreenIdentity.classify(portraitHelper()) == ScreenIdentity.CUE_HELPER);
        check("dark office with lit meter is identified as night",
                ScreenIdentity.classify(nightWithFlash()) == ScreenIdentity.FNAF2_NIGHT);
        check("masked office is identified as night",
                ScreenIdentity.classify(nightWithMask()) == ScreenIdentity.FNAF2_NIGHT);
        check("title menu is diagnostic menu, not night",
                ScreenIdentity.classify(titleMenu()) == ScreenIdentity.FNAF2_MENU);
        check("menu identity wins an ambiguous red-accent frame",
                ScreenIdentity.classify(ambiguousMenuWithRedAccent())
                        == ScreenIdentity.FNAF2_MENU);
        check("night label is explicit",
                "FNAF2_NIGHT".equals(ScreenIdentity.label(ScreenIdentity.FNAF2_NIGHT)));
        check("full-frame intro card is identified for the status bar",
                ScreenIdentity.classify(introCardFrame(false),
                        filled(0x020202)) == ScreenIdentity.FNAF2_INTRO);
        check("full-frame game over is identified for the status bar",
                ScreenIdentity.classify(gameOverFrame(), filled(0x101010))
                        == ScreenIdentity.FNAF2_GAME_OVER);
        check("intro negative control with win confetti is not intro",
                ScreenIdentity.classify(introCardFrame(true), filled(0x020202))
                        != ScreenIdentity.FNAF2_INTRO);
        check("lifecycle labels are explicit",
                "FNAF2_INTRO".equals(ScreenIdentity.label(ScreenIdentity.FNAF2_INTRO))
                        && "FNAF2_GAME_OVER".equals(
                        ScreenIdentity.label(ScreenIdentity.FNAF2_GAME_OVER))
                        && ScreenIdentity.isRecognizedGameScreen(
                        ScreenIdentity.FNAF2_INTRO)
                        && ScreenIdentity.isRecognizedGameScreen(
                        ScreenIdentity.FNAF2_GAME_OVER));
        // A real menu must never classify as a night: that verdict is the
        // host's positive gate for admitting calibration trials.
        int[][] captured = { capturedMenu0(), capturedMenu1(), capturedMenu2() };
        for (int index = 0; index < captured.length; index++) {
            check("captured live menu " + index + " is not a night",
                    ScreenIdentity.classify(captured[index]) != ScreenIdentity.FNAF2_NIGHT);
            check("captured live menu " + index + " classifies as the menu",
                    ScreenIdentity.classify(captured[index]) == ScreenIdentity.FNAF2_MENU);
        }
        // The FNaF title is deliberately grey/white and must not be inferred
        // as the helper merely because it is a dark 20x9 frame.
        check("foreign grey frame is unknown",
                ScreenIdentity.classify(filled(0x1b1b1b)) == ScreenIdentity.UNKNOWN);
        check("invalid grid size is unknown",
                ScreenIdentity.classify(new int[PixelWatch.GRID_WIDTH])
                        == ScreenIdentity.UNKNOWN);
        check("unknown label is fail-closed",
                "UNKNOWN".equals(ScreenIdentity.label(ScreenIdentity.UNKNOWN)));

        if (failures > 0) {
            System.out.println(failures + " check(s) failed");
            System.exit(1);
        }
        System.out.println("ScreenIdentityTest: all checks passed");
    }
}
