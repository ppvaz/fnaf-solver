package com.ppvaz.fnafcompanion;

import static com.ppvaz.fnafcompanion.Check.check;

import java.nio.ByteBuffer;

/** Host-only contract: the plane view reads exactly the pixels the plane holds. */
public final class NativeFrameTest {
    /** The per-pixel read the view replaced, kept as the reference. */
    private static int reference(ByteBuffer buffer, int width, int height,
            int rowStride, int pixelStride, int x, int y) {
        if (x < 0 || y < 0 || x >= width || y >= height) return NativeFrame.UNKNOWN;
        int offset = y * rowStride + x * pixelStride;
        if (offset < 0 || offset + 2 >= buffer.limit()) return NativeFrame.UNKNOWN;
        return ((buffer.get(offset) & 0xff) << 16)
                | ((buffer.get(offset + 1) & 0xff) << 8)
                | (buffer.get(offset + 2) & 0xff);
    }

    /**
     * A direct plane as ImageReader hands it over: padded rows, and a last row
     * that ends at its last pixel, not at the stride.
     */
    private static ByteBuffer plane(int width, int height, int rowStride, int seed) {
        int limit = rowStride * (height - 1) + width * 4;
        ByteBuffer buffer = ByteBuffer.allocateDirect(limit);
        for (int i = 0; i < limit; i++) buffer.put(i, (byte) (i * 31 + seed));
        return buffer;
    }

    private static int mismatches(NativeFrame.ByteBufferView view, ByteBuffer buffer,
            int width, int height, int rowStride) {
        int wrong = 0;
        for (int y = -1; y <= height; y++) {
            for (int x = -1; x <= width; x++) {
                if (view.rgb(x, y) != reference(buffer, width, height, rowStride, 4, x, y)) wrong++;
            }
        }
        return wrong;
    }

    public static void main(String[] args) {
        int width = 7;
        int height = 5;
        int rowStride = 40;
        NativeFrame.ByteBufferView view = new NativeFrame.ByteBufferView();
        check("an unset view reads nothing", view.rgb(0, 0) == NativeFrame.UNKNOWN);

        ByteBuffer first = plane(width, height, rowStride, 0);
        view.set(first, width, height, rowStride, 4);
        check("every pixel of a padded plane matches the per-pixel read",
                mismatches(view, first, width, height, rowStride) == 0);
        check("the plane's own position is left where it was", first.position() == 0);

        // Read only part of the first frame, then a different frame in the same
        // view: a row cached from the first frame must not answer for the second.
        ByteBuffer second = plane(width, height, rowStride, 101);
        view.set(first, width, height, rowStride, 4);
        view.rgb(3, 2);
        view.set(second, width, height, rowStride, 4);
        check("a second frame reads its own rows, never the previous frame's",
                mismatches(view, second, width, height, rowStride) == 0);

        // A plane whose last row is short of a whole pixel answers UNKNOWN there.
        ByteBuffer cut = ByteBuffer.allocateDirect(rowStride * (height - 1) + 2);
        view.set(cut, width, height, rowStride, 4);
        check("a pixel past the buffer's end is UNKNOWN",
                view.rgb(0, height - 1) == NativeFrame.UNKNOWN);
        check("a cut plane still matches the per-pixel read",
                mismatches(view, cut, width, height, rowStride) == 0);

        // A larger frame after a smaller one grows the copy rather than reading past it.
        int bigWidth = 33;
        int bigHeight = 9;
        int bigStride = 33 * 4 + 12;
        ByteBuffer big = plane(bigWidth, bigHeight, bigStride, 7);
        view.set(big, bigWidth, bigHeight, bigStride, 4);
        check("a larger frame after a smaller one matches the per-pixel read",
                mismatches(view, big, bigWidth, bigHeight, bigStride) == 0);

        Check.done("NativeFrameTest: the plane view reads every pixel as the plane holds it");
    }
}
