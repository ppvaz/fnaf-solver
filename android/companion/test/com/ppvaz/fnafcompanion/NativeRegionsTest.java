package com.ppvaz.fnafcompanion;

/** Host-only contract for the native-region primitive. */
public final class NativeRegionsTest {
    private static int failures;

    private static void check(String what, boolean condition) {
        if (!condition) {
            System.out.println("FAIL " + what);
            failures++;
        }
    }

    /** A frame whose pixel encodes its own coordinates, so a copy can be audited. */
    private static final class Frame implements NativeFrame {
        private final int width;
        private final int height;
        Frame(int width, int height) { this.width = width; this.height = height; }
        @Override public int width() { return width; }
        @Override public int height() { return height; }
        @Override public int rgb(int x, int y) {
            if (x < 0 || y < 0 || x >= width || y >= height) return PixelWatch.UNKNOWN;
            return ((x & 0xfff) << 12) | (y & 0xfff);
        }
    }

    private static String field(String line, String name) {
        for (String token : line.split(" ")) {
            if (token.startsWith(name + "=")) return token.substring(name.length() + 1);
        }
        return null;
    }

    public static void main(String[] args) {
        NativeRegions regions = new NativeRegions(2400, 1080);
        check("empty read has no frame", "-1".equals(field(regions.read(), "seq")));

        check("bad name refused", "region-name".equals(regions.set("Left", 0, 0, 4, 4, 1)));
        check("out of bounds refused", "region-bounds".equals(regions.set("a", 2398, 0, 4, 4, 1)));
        check("zero step refused", "region-step".equals(regions.set("a", 0, 0, 4, 4, 0)));
        check("too many samples refused",
                "region-samples".equals(regions.set("a", 0, 0, 100, 100, 1)));
        check("strided large region fits", regions.set("big", 0, 0, 400, 400, 5) == null);
        check("second region fits", regions.set("door_left", 100, 600, 3, 2, 1) == null);
        check("two regions", regions.size() == 2);

        check("registered but not yet copied reads seq -1",
                "-1".equals(field(regions.read(), "seq")));

        Frame frame = new Frame(2400, 1080);
        check("capture succeeds", regions.capture(frame, 7, 1234L, 1300L));
        String line = regions.read();
        check("seq published", "7".equals(field(line, "seq")));
        check("image time published", "1234".equals(field(line, "imageNs")));
        check("copy time published", "1300".equals(field(line, "copiedNs")));

        // door_left is 3x2 at (100,600): six raw pixels, row-major.
        String body = field(line, "door_left");
        check("geometry echoed", body != null && body.startsWith("100,600,3,2,1:"));
        String hex = body == null ? "" : body.substring(body.indexOf(':') + 1);
        check("six samples", hex.length() == 36);
        int first = Integer.parseInt(hex.substring(0, 6), 16);
        int last = Integer.parseInt(hex.substring(30, 36), 16);
        check("first sample is (100,600)", first == ((100 << 12) | 600));
        check("last sample is (102,601)", last == ((102 << 12) | 601));

        // The strided region samples every 5th pixel, unblended.
        String big = field(line, "big");
        String bigHex = big == null ? "" : big.substring(big.indexOf(':') + 1);
        check("strided sample count", bigHex.length() == 80 * 80 * 6);
        int second = Integer.parseInt(bigHex.substring(6, 12), 16);
        check("stride is a pixel, not an average", second == ((5 << 12) | 0));

        // Replacing a region keeps the others and never publishes a partial set.
        check("replace by name", regions.set("door_left", 200, 600, 2, 2, 1) == null);
        check("still two regions", regions.size() == 2);
        check("new geometry is not read before a copy", "-1".equals(field(regions.read(), "seq")));
        check("next frame publishes it", regions.capture(frame, 8, 2000L, 2100L));
        check("replacement read back",
                field(regions.read(), "door_left").startsWith("200,600,2,2,1:"));

        // A frame of the wrong size publishes nothing.
        check("foreign frame refused", !regions.capture(new Frame(1080, 2400), 9, 3000L, 3100L));
        check("previous frame still current", "8".equals(field(regions.read(), "seq")));

        regions.clear();
        check("clear empties", regions.size() == 0 && "-1".equals(field(regions.read(), "seq")));

        if (failures > 0) {
            System.out.println("NativeRegionsTest: " + failures + " failure(s)");
            System.exit(1);
        }
        System.out.println("NativeRegionsTest: all checks passed");
    }
}
