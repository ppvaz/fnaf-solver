package com.ppvaz.fnafcompanion;

/**
 * LEGACY (FNaF 2 retail 2.0.7 on the moto g56): the fail-closed screen
 * identity the FNaF 2 night lane still reads from {@code FRAME}/{@code GET}.
 *
 * <p>It is a grid-fitted rule -- discontinued as a starting point by
 * CLAUDE.md -- kept only because the FNaF 2 onset latch, the executor's native
 * night anchor and the grid-fitted monitor/mask rules consume its label. It
 * runs only while the Companion's target is FNaF 2 ({@link Fnaf2Legacy}); any
 * other target reads {@code screen=UNKNOWN}, never a FNaF 2 label. Game
 * identity for setup comes from each game's own title regions on the host
 * ({@code tools/device/game-screen.py}).</p>
 *
 * <p>Original notes follow.</p>
 *
 * <p>The capture grid is intentionally tiny and point-sampled. This classifier
 * therefore uses stable UI colour anchors rather than pretending that the grid
 * is an OCR image. The anchors come from the locally retained Cue Helper
 * frames in both orientations: dark display background, panel fill, and the
 * Bonnie/Freddy/Chica control colours. Dynamic status text is not used.</p>
 *
 * <p>Besides the helper, this class has a conservative FNaF 2 night/menu
 * diagnostic and a status-only lifecycle classifier. Only
 * {@link #FNAF2_NIGHT} can authorize audio observations; menu, intro,
 * game-over, and every unrecognized frame remain non-authorizing.</p>
 */
public final class ScreenIdentity {
    public static final int UNKNOWN = 0;
    public static final int CUE_HELPER = 1;
    public static final int FNAF2_NIGHT = 2;
    public static final int FNAF2_MENU = 3;
    public static final int FNAF2_INTRO = 4;
    public static final int FNAF2_GAME_OVER = 5;

    private static final int GRID_WIDTH = PixelWatch.GRID_WIDTH;
    private static final int GRID_HEIGHT = PixelWatch.GRID_HEIGHT;

    private static final int BACKGROUND = 0x120a0b;
    private static final int PANEL = 0x1f1012;
    private static final int BONNIE = 0x5f3989;
    private static final int FREDDY = 0x6f422b;
    private static final int CHICA = 0xd3a623;
    private static final int MANGLE = 0xb23a59;
    private static final int AMBER = 0xffb020;

    // Keep the background and panel colours distinct: their channel distance
    // is 26, so a broad tolerance would turn an all-dark foreign screen into
    // a false helper match.
    private static final int COLOR_TOLERANCE = 12;
    private static final int LANDSCAPE_THRESHOLD = 14;
    private static final int PORTRAIT_THRESHOLD = 8;
    private static final int LIFECYCLE_BRIGHT_MIN = 150;
    private static final int LIFECYCLE_DARK_MEAN_MAX = 5;
    private static final double GAME_OVER_RED_FACE_MIN = .05d;
    private static final double GAME_OVER_BRIGHT_TEXT_MIN = .08d;
    private static final double INTRO_CLOCK_COLUMNS_MIN = .10d;
    private static final double INTRO_CONFETTI_MAX = .0002d;
    private static final double INTRO_TEXT_MIN = .04d;
    private static final double INTRO_OUTER_MAX = .005d;
    private static final double INTRO_ROUGHNESS_MAX = 1.2d;

    private ScreenIdentity() {
    }

    /** Return {@link #CUE_HELPER} only when one of the calibrated layouts fits. */
    public static int classify(int[] grid) {
        if (grid == null || grid.length != GRID_WIDTH * GRID_HEIGHT) {
            return UNKNOWN;
        }
        if (landscapeScore(grid) >= LANDSCAPE_THRESHOLD
                || portraitScore(grid) >= PORTRAIT_THRESHOLD) {
            return CUE_HELPER;
        }
        // A menu-like frame wins an ambiguous dark/red match. This keeps a
        // title/menu accent from being mistaken for the night mask bar and
        // prevents the overlay from annotating absent office elements.
        if (menuScore(grid) >= 5) {
            return FNAF2_MENU;
        }
        return nightScore(grid) > 0 ? FNAF2_NIGHT : UNKNOWN;
    }

    /**
     * Classify the current native-resolution frame for the debug status bar.
     *
     * <p>The 20x9 grid remains the authority for helper/menu/night identity.
     * The two lifecycle labels need more spatial information than that grid
     * has, so they use the already-captured full frame only after the grid has
     * failed to identify a recognized game state. They are display labels, not
     * alive/dead or cue-authorizing facts.</p>
     */
    public static int classify(NativeFrame frame, int[] grid) {
        int gridIdentity = classify(grid);
        if (gridIdentity == CUE_HELPER || gridIdentity == FNAF2_MENU
                || gridIdentity == FNAF2_NIGHT || !nativeFrame(frame)) {
            return gridIdentity;
        }
        if (gameOverScore(frame)) return FNAF2_GAME_OVER;
        if (introCardScore(frame)) return FNAF2_INTRO;
        return gridIdentity;
    }

    /** Return whether an identity is safe to keep the debug window attached. */
    public static boolean isRecognizedGameScreen(int identity) {
        return identity == FNAF2_NIGHT || identity == FNAF2_MENU
                || identity == FNAF2_INTRO || identity == FNAF2_GAME_OVER;
    }

    public static String label(int state) {
        switch (state) {
            case CUE_HELPER:
                return "CUE_HELPER";
            case FNAF2_NIGHT:
                return "FNAF2_NIGHT";
            case FNAF2_MENU:
                return "FNAF2_MENU";
            case FNAF2_INTRO:
                return "FNAF2_INTRO";
            case FNAF2_GAME_OVER:
                return "FNAF2_GAME_OVER";
            default:
                return "UNKNOWN";
        }
    }

    /** The screen identity itself remains grid-first and fail-closed. */
    private static boolean nativeFrame(NativeFrame frame) {
        return frame != null && frame.width() == PixelWatch.NATIVE_WIDTH
                && frame.height() == PixelWatch.NATIVE_HEIGHT;
    }

    /** Port of the measured full-frame Game Over signature. */
    private static boolean gameOverScore(NativeFrame frame) {
        double redFace = fraction(frame, 650, 450, 1750, 920,
                32, 32, true);
        double brightText = fraction(frame, 900, 950, 1450, 1040,
                32, 32, false);
        return redFace > GAME_OVER_RED_FACE_MIN
                && brightText > GAME_OVER_BRIGHT_TEXT_MIN;
    }

    /** Port of the measured generic intro-card conjunction. */
    private static boolean introCardScore(NativeFrame frame) {
        if (meanLuma(frame, 0, 0, PixelWatch.NATIVE_WIDTH,
                PixelWatch.NATIVE_HEIGHT, 8) >= LIFECYCLE_DARK_MEAN_MAX) {
            return false;
        }
        if (brightColumnFraction(frame, 936, 432, 1464, 605,
                4, 4) < INTRO_CLOCK_COLUMNS_MIN) {
            return false;
        }
        // A 6 AM win screen has the same dark clock/card geometry. Its sparse
        // saturated confetti is the measured negative control for intro.
        if (saturatedFraction(frame, 0, 0, PixelWatch.NATIVE_WIDTH, 486, 4)
                >= INTRO_CONFETTI_MAX) {
            return false;
        }
        if (fraction(frame, 864, 389, 1536, 648,
                32, 32, false) < INTRO_TEXT_MIN) {
            return false;
        }
        if (fraction(frame, 0, 0, PixelWatch.NATIVE_WIDTH, 270,
                32, 8, false) > INTRO_OUTER_MAX) {
            return false;
        }
        return roughness(frame, 240, 108, 2160, 972, 4)
                <= INTRO_ROUGHNESS_MAX;
    }

    private static double fraction(NativeFrame frame, int x0, int y0,
            int x1, int y1, int sampleWidth, int sampleHeight,
            boolean redFace) {
        int matches = 0;
        int total = sampleWidth * sampleHeight;
        for (int sy = 0; sy < sampleHeight; sy++) {
            int y = sampleCoordinate(y0, y1, sy, sampleHeight);
            for (int sx = 0; sx < sampleWidth; sx++) {
                int rgb = frame.rgb(sampleCoordinate(x0, x1, sx, sampleWidth), y);
                int red = (rgb >> 16) & 0xff;
                int green = (rgb >> 8) & 0xff;
                int blue = rgb & 0xff;
                boolean match = redFace
                        ? red > 80 && red > green * 1.5d && red > blue * 1.3d
                        : red > LIFECYCLE_BRIGHT_MIN
                                && green > LIFECYCLE_BRIGHT_MIN
                                && blue > LIFECYCLE_BRIGHT_MIN;
                if (match) matches++;
            }
        }
        return matches / (double) total;
    }

    private static int sampleCoordinate(int start, int end, int index,
            int sampleCount) {
        return start + ((2 * index + 1) * (end - start)) / (2 * sampleCount);
    }

    private static int meanLuma(NativeFrame frame, int x0, int y0,
            int x1, int y1, int step) {
        long total = 0L;
        int count = 0;
        for (int y = y0; y < y1; y += step) {
            for (int x = x0; x < x1; x += step) {
                total += luma(frame.rgb(x, y));
                count++;
            }
        }
        return count == 0 ? 0 : (int) (total / count);
    }

    private static double brightColumnFraction(NativeFrame frame,
            int x0, int y0, int x1, int y1, int xStep, int yStep) {
        int columns = 0;
        int litColumns = 0;
        for (int x = x0; x < x1; x += xStep) {
            columns++;
            for (int y = y0; y < y1; y += yStep) {
                int rgb = frame.rgb(x, y);
                if (((rgb >> 16) & 0xff) > LIFECYCLE_BRIGHT_MIN
                        && ((rgb >> 8) & 0xff) > LIFECYCLE_BRIGHT_MIN
                        && (rgb & 0xff) > LIFECYCLE_BRIGHT_MIN) {
                    litColumns++;
                    break;
                }
            }
        }
        return litColumns / (double) Math.max(1, columns);
    }

    private static double saturatedFraction(NativeFrame frame,
            int x0, int y0, int x1, int y1, int step) {
        int saturated = 0;
        int count = 0;
        for (int y = y0; y < y1; y += step) {
            for (int x = x0; x < x1; x += step) {
                int rgb = frame.rgb(x, y);
                int red = (rgb >> 16) & 0xff;
                int green = (rgb >> 8) & 0xff;
                int blue = rgb & 0xff;
                int maximum = Math.max(red, Math.max(green, blue));
                int minimum = Math.min(red, Math.min(green, blue));
                if (maximum > 70 && maximum - minimum > 50) saturated++;
                count++;
            }
        }
        return saturated / (double) Math.max(1, count);
    }

    private static double roughness(NativeFrame frame, int x0, int y0,
            int x1, int y1, int step) {
        long total = 0L;
        int count = 0;
        for (int y = y0; y + 1 < y1; y += step) {
            for (int x = x0; x < x1; x += step) {
                total += Math.abs(luma(frame.rgb(x, y))
                        - luma(frame.rgb(x, y + 1)));
                count++;
            }
        }
        return total / (double) Math.max(1, count);
    }

    private static int luma(int rgb) {
        int red = (rgb >> 16) & 0xff;
        int green = (rgb >> 8) & 0xff;
        int blue = rgb & 0xff;
        return (77 * red + 150 * green + 29 * blue) >> 8;
    }

    /**
     * Conservative approximation of the established phone-side night rule:
     * the frame must be globally dark and show either the lit flashlight meter
     * or the pink mask bar. A title/menu frame is therefore never a night.
     */
    private static int nightScore(int[] grid) {
        if (globalMeanLuma(grid) >= 80) {
            return 0;
        }
        int score = 0;
        if (meanCells(grid, 0, 0, 2, 1) > 90) {
            score += 6;
        }
        int maskRed = meanChannel(grid, 1, 8, 10, 9, 16);
        int maskBlue = meanChannel(grid, 1, 8, 10, 9, 0);
        if (maskRed > 50 && maskRed > maskBlue * 1.3) {
            score += 6;
        }
        return score;
    }

    /** Menu is diagnostic only; it can never authorize audio cues. */
    private static int menuScore(int[] grid) {
        if (globalMeanLuma(grid) >= 80) {
            return 0;
        }
        int brightTop = brightCells(grid, 0, 0, 10, 3);
        int brightOptions = brightCells(grid, 0, 3, 12, 7);
        return (brightTop >= 3 ? 3 : 0)
                + (brightOptions >= 2 ? 2 : 0);
    }

    private static int globalMeanLuma(int[] grid) {
        long total = 0L;
        int count = 0;
        for (int y = 4; y <= 6; y += 2) {
            for (int x = 0; x < GRID_WIDTH; x++) {
                int rgb = grid[y * GRID_WIDTH + x];
                int red = (rgb >> 16) & 0xff;
                int green = (rgb >> 8) & 0xff;
                int blue = rgb & 0xff;
                total += (77 * red + 150 * green + 29 * blue) >> 8;
                count++;
            }
        }
        return (int) (total / count);
    }

    private static int meanCells(int[] grid, int x0, int y0, int x1, int y1) {
        long total = 0L;
        int count = 0;
        for (int y = y0; y < y1; y++) {
            for (int x = x0; x < x1; x++) {
                int rgb = grid[y * GRID_WIDTH + x];
                int red = (rgb >> 16) & 0xff;
                int green = (rgb >> 8) & 0xff;
                int blue = rgb & 0xff;
                total += (77 * red + 150 * green + 29 * blue) >> 8;
                count++;
            }
        }
        return count == 0 ? 0 : (int) (total / count);
    }

    private static int meanChannel(int[] grid, int x0, int y0, int x1, int y1,
            int shift) {
        long total = 0L;
        int count = 0;
        for (int y = y0; y < y1; y++) {
            for (int x = x0; x < x1; x++) {
                int rgb = grid[y * GRID_WIDTH + x];
                total += (rgb >> shift) & 0xff;
                count++;
            }
        }
        return count == 0 ? 0 : (int) (total / count);
    }

    private static int brightCells(int[] grid, int x0, int y0, int x1, int y1) {
        int count = 0;
        for (int y = y0; y < y1; y++) {
            for (int x = x0; x < x1; x++) {
                int rgb = grid[y * GRID_WIDTH + x];
                int red = (rgb >> 16) & 0xff;
                int green = (rgb >> 8) & 0xff;
                int blue = rgb & 0xff;
                if (red > 150 && green > 150 && blue > 150) {
                    count++;
                }
            }
        }
        return count;
    }

    private static int landscapeScore(int[] grid) {
        int score = 0;
        score += near(grid, 0, 0, BACKGROUND) ? 2 : 0;
        score += near(grid, 0, 8, BACKGROUND) ? 2 : 0;
        score += near(grid, 19, 8, BACKGROUND) ? 1 : 0;
        score += near(grid, 1, 2, PANEL) ? 1 : 0;
        score += near(grid, 1, 7, PANEL) ? 1 : 0;
        score += near(grid, 19, 7, PANEL) ? 1 : 0;

        // The three stacked control buttons are stable across capture state.
        score += near(grid, 16, 3, BONNIE) ? 4 : 0;
        score += near(grid, 16, 4, FREDDY) ? 4 : 0;
        score += near(grid, 16, 5, CHICA) ? 4 : 0;

        // The amber title is a weak supporting signal, never the identity by
        // itself because game text can also be bright.
        score += near(grid, 8, 1, AMBER) ? 1 : 0;
        score += near(grid, 9, 1, AMBER) ? 1 : 0;
        return score;
    }

    private static int portraitScore(int[] grid) {
        int score = 0;
        score += near(grid, 0, 0, BACKGROUND) ? 2 : 0;
        score += near(grid, 19, 8, BACKGROUND) ? 2 : 0;
        score += near(grid, 1, 3, PANEL) ? 1 : 0;

        // Earlier portrait frames place the cards at slightly different
        // vertical positions as the explanatory text changes. Count the broad
        // button fills instead of depending on one row for those frames.
        score += countNear(grid, FREDDY) >= 12 ? 4 : 0;
        score += countNear(grid, MANGLE) >= 12 ? 4 : 0;

        // In portrait the vertical control stack exposes the Freddy and
        // Mangle fills in broad, stable rows.
        score += near(grid, 2, 5, FREDDY) ? 2 : 0;
        score += near(grid, 10, 5, FREDDY) ? 2 : 0;
        score += near(grid, 2, 6, MANGLE) ? 2 : 0;
        score += near(grid, 10, 6, MANGLE) ? 2 : 0;
        return score;
    }

    private static int countNear(int[] grid, int expected) {
        int count = 0;
        for (int actual : grid) {
            int distance = Math.abs(((actual >> 16) & 0xff) - ((expected >> 16) & 0xff))
                    + Math.abs(((actual >> 8) & 0xff) - ((expected >> 8) & 0xff))
                    + Math.abs((actual & 0xff) - (expected & 0xff));
            if (distance <= COLOR_TOLERANCE) count++;
        }
        return count;
    }

    private static boolean near(int[] grid, int x, int y, int expected) {
        int actual = grid[y * GRID_WIDTH + x];
        int distance = Math.abs(((actual >> 16) & 0xff) - ((expected >> 16) & 0xff))
                + Math.abs(((actual >> 8) & 0xff) - ((expected >> 8) & 0xff))
                + Math.abs((actual & 0xff) - (expected & 0xff));
        return distance <= COLOR_TOLERANCE;
    }
}
