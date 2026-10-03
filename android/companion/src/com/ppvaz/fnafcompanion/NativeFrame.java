package com.ppvaz.fnafcompanion;

import java.nio.Buffer;
import java.nio.ByteBuffer;
import java.util.Arrays;

/**
 * One captured frame at the display's native resolution, read one unblended
 * pixel at a time.
 *
 * <p>This is the only view of a frame the game-agnostic readers take: the
 * region copier ({@link NativeRegions}), the whole-frame snap and the FNaF 2
 * legacy readers ({@link Fnaf2Legacy}). It has no Android dependency, so every
 * reader is exercised on the host by a synthetic frame.</p>
 */
public interface NativeFrame {
    /** A pixel that could not be read: outside the frame or a short buffer. */
    int UNKNOWN = Integer.MIN_VALUE;
    /** The calibrated handset's display (moto g56, landscape). */
    int WIDTH = 2400;
    int HEIGHT = 1080;

    int width();

    int height();

    /** 0xRRGGBB of native pixel (x, y), or {@link #UNKNOWN}. */
    int rgb(int x, int y);

    /**
     * Each pixel as six lowercase hex digits, RRGGBB, appended in order: the
     * wire form of REGION reads and of the frozen trace's grid column.
     */
    static void appendRgbHex(StringBuilder out, int[] pixels) {
        final String digits = "0123456789abcdef";
        for (int rgb : pixels) {
            out.append(digits.charAt((rgb >> 20) & 0xf)).append(digits.charAt((rgb >> 16) & 0xf))
                    .append(digits.charAt((rgb >> 12) & 0xf)).append(digits.charAt((rgb >> 8) & 0xf))
                    .append(digits.charAt((rgb >> 4) & 0xf)).append(digits.charAt(rgb & 0xf));
        }
    }

    /**
     * A reusable view over one ImageReader plane (RGBA_8888), for the capture
     * thread only.
     *
     * <p>A pixel is read from this frame's copy of its row, never from the
     * buffer itself. The Companion is debuggable (the host reads its files with
     * run-as), and a debuggable process does not intrinsify
     * {@code DirectByteBuffer.get}: every byte read was a JNI call, three per
     * pixel, and half the capture thread's samples at the FNaF 2 menu on the
     * moto g56. A row is copied with one bulk get the first time a reader
     * touches it in a frame; the thread's CPU per frame fell from 4.5-6.8 ms
     * to 3.5-5.2 ms at 60 fps (companion-capture-cpu-d9ecf3eadaba659a).</p>
     */
    final class ByteBufferView implements NativeFrame {
        private ByteBuffer source;
        private int width;
        private int height;
        private int rowStride;
        private int pixelStride;
        private int limit;
        private byte[] rows = new byte[0];
        private int[] rowFrame = new int[0];
        private int frame;

        public void set(ByteBuffer buffer, int width, int height,
                int rowStride, int pixelStride) {
            // A duplicate, so positioning it for bulk gets leaves the plane's
            // own buffer where the SNAP copy expects it.
            this.source = buffer == null ? null : buffer.duplicate();
            this.width = width;
            this.height = height;
            this.rowStride = rowStride;
            this.pixelStride = pixelStride;
            this.limit = buffer == null ? 0 : buffer.limit();
            if (rows.length < limit) rows = new byte[limit];
            if (rowFrame.length < height) rowFrame = new int[height];
            if (++frame == 0) {
                Arrays.fill(rowFrame, 0);
                frame = 1;
            }
        }

        @Override public int width() { return width; }

        @Override public int height() { return height; }

        @Override public int rgb(int x, int y) {
            if (source == null || x < 0 || y < 0 || x >= width || y >= height) {
                return UNKNOWN;
            }
            int offset = y * rowStride + x * pixelStride;
            if (offset < 0 || offset + 2 >= limit) return UNKNOWN;
            if (rowFrame[y] != frame) {
                int start = y * rowStride;
                // Through Buffer: ByteBuffer.position(int) returns ByteBuffer only from API 30.
                ((Buffer) source).position(start);
                source.get(rows, start, Math.min(rowStride, limit - start));
                rowFrame[y] = frame;
            }
            return ((rows[offset] & 0xff) << 16)
                    | ((rows[offset + 1] & 0xff) << 8)
                    | (rows[offset + 2] & 0xff);
        }
    }
}
